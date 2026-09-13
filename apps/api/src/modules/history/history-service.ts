import { sql } from "drizzle-orm";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";

export type HistoryRole = "player" | "judge";
export type HistoryResult = "win" | "loss";
export type HistoryEventType = "match" | "tournament";

export type HistoryQuery = {
  role?: HistoryRole;
  result?: HistoryResult;
  eventType?: HistoryEventType;
  from?: Date;
  to?: Date;
  q?: string;
  cursor?: string;
  limit: number;
};

export type HistoryItem = {
  type: HistoryEventType;
  id: string;
  title: string;
  status: string;
  occurredAt: string;
  roles: Array<"player" | "judge" | "organizer" | "viewer">;
  result: HistoryResult | null;
  matchKind: string | null;
  scoreA: number | null;
  scoreB: number | null;
  format: string | null;
};

type Cursor = {
  v: 1;
  occurredAt: string;
  type: HistoryEventType;
  id: string;
};

type HistoryRow = {
  event_type: HistoryEventType;
  id: string;
  title: string;
  status: string;
  occurred_at: Date | string;
  is_player: boolean;
  is_judge: boolean;
  is_organizer: boolean;
  result: HistoryResult | null;
  match_kind: string | null;
  score_a: number | null;
  score_b: number | null;
  format: string | null;
  search_text: string;
};

function validationError(message: string) {
  return Object.assign(new Error(message), { code: "VALIDATION" });
}

function encodeCursor(item: HistoryItem): string {
  const cursor: Cursor = {
    v: 1,
    occurredAt: item.occurredAt,
    type: item.type,
    id: item.id,
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(encoded?: string): Cursor | null {
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<Cursor>;
    const occurredAt = new Date(String(parsed.occurredAt));
    if (
      parsed.v !== 1 ||
      (parsed.type !== "match" && parsed.type !== "tournament") ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.id,
      ) ||
      Number.isNaN(occurredAt.getTime())
    ) {
      throw new Error("invalid cursor");
    }
    return {
      v: 1,
      occurredAt: occurredAt.toISOString(),
      type: parsed.type,
      id: parsed.id,
    };
  } catch {
    throw validationError("Некорректный cursor истории");
  }
}

function escapedSearchPattern(q?: string): string | null {
  if (!q) return null;
  return `%${q.replace(/[\\%_]/g, "\\$&").toLocaleLowerCase("ru-RU")}%`;
}

export class HistoryService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async list(actorUserId: string, query: HistoryQuery) {
    const cursor = decodeCursor(query.cursor);
    const searchPattern = escapedSearchPattern(query.q);
    const now = this.clock.now().toISOString();
    const from = query.from?.toISOString() ?? null;
    const to = query.to?.toISOString() ?? null;
    const result = await this.db.execute<HistoryRow>(sql`
      with history_events as (
        select
          'match'::text as event_type,
          m.id,
          m.title,
          m.status::text as status,
          coalesce(m.finished_at, m.updated_at, m.created_at) as occurred_at,
          exists (
            select 1 from match_participants actor_mp
            where actor_mp.match_id = m.id and actor_mp.user_id = ${actorUserId}::uuid
          ) as is_player,
          exists (
            select 1 from judge_sessions actor_js
            where actor_js.match_id = m.id and actor_js.user_id = ${actorUserId}::uuid
          ) as is_judge,
          (m.created_by_user_id = ${actorUserId}::uuid) as is_organizer,
          case
            when m.status in ('finished', 'stopped') and exists (
              select 1 from match_participants result_mp
              where result_mp.match_id = m.id
                and result_mp.user_id = ${actorUserId}::uuid
                and result_mp.side = m.winner_side
            ) then 'win'
            when m.status in ('finished', 'stopped') and exists (
              select 1 from match_participants result_mp
              where result_mp.match_id = m.id
                and result_mp.user_id = ${actorUserId}::uuid
                and m.winner_side is not null
                and result_mp.side <> m.winner_side
            ) then 'loss'
            else null
          end::text as result,
          m.kind::text as match_kind,
          m.score_a,
          m.score_b,
          m.format::text as format,
          lower(concat_ws(' ', m.title, (
            select string_agg(
              coalesce(nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''),
                nullif(trim(concat_ws(' ', opponent_mp.guest_first_name, opponent_mp.guest_last_name)), '')),
              ' '
            )
            from match_participants opponent_mp
            left join users u on u.id = opponent_mp.user_id
            where opponent_mp.match_id = m.id
              and (
                not exists (
                  select 1 from match_participants actor_side
                  where actor_side.match_id = m.id
                    and actor_side.user_id = ${actorUserId}::uuid
                )
                or opponent_mp.side <> (
                  select actor_side.side from match_participants actor_side
                  where actor_side.match_id = m.id
                    and actor_side.user_id = ${actorUserId}::uuid
                  limit 1
                )
              )
          ))) as search_text
        from matches m
        where m.kind <> 'tutorial'
          and (
            m.status in ('finished', 'stopped', 'cancelled', 'voided')
            or m.created_by_user_id = ${actorUserId}::uuid
            or exists (
              select 1 from match_participants visible_mp
              where visible_mp.match_id = m.id and visible_mp.user_id = ${actorUserId}::uuid
            )
            or exists (
              select 1 from judge_sessions visible_js
              where visible_js.match_id = m.id
                and visible_js.user_id = ${actorUserId}::uuid
                and visible_js.released_at is null
                and visible_js.expires_at > ${now}
            )
          )

        union all

        select
          'tournament'::text as event_type,
          t.id,
          t.title,
          t.status::text as status,
          coalesce(t.finished_at, t.updated_at, t.created_at) as occurred_at,
          exists (
            select 1 from tournament_participants actor_tp
            where actor_tp.tournament_id = t.id and actor_tp.user_id = ${actorUserId}::uuid
          ) as is_player,
          exists (
            select 1
            from matches judge_match
            join judge_sessions actor_js on actor_js.match_id = judge_match.id
            where judge_match.tournament_id = t.id and actor_js.user_id = ${actorUserId}::uuid
          ) as is_judge,
          (t.created_by_user_id = ${actorUserId}::uuid) as is_organizer,
          case
            when t.status = 'finished' and exists (
              select 1 from tournament_participants champion_tp
              where champion_tp.tournament_id = t.id
                and champion_tp.id::text = t.bracket_json->>'championParticipantId'
            ) and exists (
              select 1 from tournament_participants result_tp
              where result_tp.tournament_id = t.id
                and result_tp.user_id = ${actorUserId}::uuid
                and result_tp.status = 'active'
            ) then case when exists (
              select 1 from tournament_participants winner_tp
              where winner_tp.tournament_id = t.id
                and winner_tp.user_id = ${actorUserId}::uuid
                and winner_tp.id::text = t.bracket_json->>'championParticipantId'
            ) then 'win' else 'loss' end
            else null
          end::text as result,
          null::text as match_kind,
          null::integer as score_a,
          null::integer as score_b,
          t.format::text as format,
          lower(t.title) as search_text
        from tournaments t
        where (
          t.status in ('finished', 'stopped', 'cancelled')
          or t.created_by_user_id = ${actorUserId}::uuid
          or exists (
            select 1 from tournament_participants visible_tp
            where visible_tp.tournament_id = t.id
              and visible_tp.user_id = ${actorUserId}::uuid
              and visible_tp.status = 'active'
          )
          or exists (
            select 1
            from matches visible_match
            join judge_sessions visible_js on visible_js.match_id = visible_match.id
            where visible_match.tournament_id = t.id
              and visible_js.user_id = ${actorUserId}::uuid
              and visible_js.released_at is null
              and visible_js.expires_at > ${now}
          )
        )
      )
      select * from history_events
      where (${query.eventType ?? null}::text is null or event_type = ${query.eventType ?? null})
        and (
          ${query.role ?? null}::text is null
          or (${query.role ?? null} = 'player' and is_player)
          or (${query.role ?? null} = 'judge' and is_judge)
        )
        and (${query.result ?? null}::text is null or result = ${query.result ?? null})
        and (${from}::timestamptz is null or occurred_at >= ${from})
        and (${to}::timestamptz is null or occurred_at <= ${to})
        and (${searchPattern}::text is null or search_text ilike ${searchPattern} escape '\\')
        and (
          ${cursor?.occurredAt ?? null}::timestamptz is null
          or (occurred_at, event_type, id::text) < (
            ${cursor?.occurredAt ?? null}::timestamptz,
            ${cursor?.type ?? null}::text,
            ${cursor?.id ?? null}::text
          )
        )
      order by occurred_at desc, event_type desc, id desc
      limit ${query.limit + 1}
    `);

    // PGlite wraps rows; postgres-js returns the row array directly.
    const rows: HistoryRow[] = Array.isArray(result) ? result : result.rows;
    const items: HistoryItem[] = rows.slice(0, query.limit).map((row) => {
      const roles: HistoryItem["roles"] = [];
      if (row.is_player) roles.push("player");
      if (row.is_judge) roles.push("judge");
      if (row.is_organizer) roles.push("organizer");
      if (roles.length === 0) roles.push("viewer");
      return {
        type: row.event_type,
        id: row.id,
        title: row.title,
        status: row.status,
        occurredAt: new Date(row.occurred_at).toISOString(),
        roles,
        result: row.result,
        matchKind: row.match_kind,
        scoreA: row.score_a,
        scoreB: row.score_b,
        format: row.format,
      };
    });
    return {
      items,
      nextCursor: rows.length > query.limit ? encodeCursor(items.at(-1)!) : null,
    };
  }
}
