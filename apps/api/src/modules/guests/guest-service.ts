import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { randomAvatarKey, type GuestIdentityMutationOutcome } from "@tab10/shared";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import { auditLogs, guestIdentities, guestIdentityRequests, users } from "../../db/schema.js";

type CatalogueCursor = {
  v: 1;
  q: string;
  lastName: string;
  firstName: string;
  id: string;
};

type HistoryCursor = {
  v: 1;
  guestId: string;
  occurredAt: string;
  type: "match" | "tournament";
  id: string;
};

type GuestHistoryRow = {
  event_type: "match" | "tournament";
  id: string;
  title: string;
  status: string;
  occurred_at: Date | string;
  cursor_occurred_at: string;
  result: "win" | "loss" | null;
  match_kind: string | null;
  score_a: number | null;
  score_b: number | null;
  side_a: string | null;
  side_b: string | null;
  format: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function domainError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function encodeCursor(value: CatalogueCursor | HistoryCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor<T>(encoded: string | undefined, validate: (value: Partial<T>) => value is T): T | null {
  if (!encoded) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<T>;
    if (!validate(value)) throw new Error("invalid cursor");
    return value;
  } catch {
    throw domainError("VALIDATION", "Некорректный cursor");
  }
}

function rowsOf<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

function isValidCursorTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth[month - 1]! && hour <= 23 &&
    minute <= 59 && second <= 59 && offsetHour <= 15 && offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value));
}

export class GuestService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private async lockActor(actorUserId: string, db: Db) {
    await db.execute(sql`select ${users.id} from ${users} where ${users.id} = ${actorUserId} for update`);
    const actor = await db.query.users.findFirst({ where: eq(users.id, actorUserId) });
    if (!actor || actor.status !== "active") throw domainError("FORBIDDEN");
    return actor;
  }

  private async lockGuest(guestId: string, db: Db) {
    await db.execute(sql`select ${guestIdentities.id} from ${guestIdentities} where ${guestIdentities.id} = ${guestId} for update`);
  }

  private present(
    row: typeof guestIdentities.$inferSelect,
    actor: Pick<typeof users.$inferSelect, "id" | "role" | "status">,
  ) {
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      displayName: `${row.lastName} ${row.firstName}`.trim(),
      avatarKey: row.avatarKey,
      version: row.version,
      canRename:
        actor.status === "active" &&
        (actor.id === row.createdByUserId || actor.role === "admin"),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create(input: {
    actorUserId: string;
    requestId: string;
    firstName: string;
    lastName: string;
  }) {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const requestFingerprint = fingerprint({ operation: "create", firstName, lastName });
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const actor = await this.lockActor(input.actorUserId, db);
      const existing = await db.query.guestIdentityRequests.findFirst({
        where: and(
          eq(guestIdentityRequests.actorUserId, input.actorUserId),
          eq(guestIdentityRequests.requestId, input.requestId),
        ),
      });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw domainError("IDEMPOTENCY_KEY_REUSED");
        const guest = await db.query.guestIdentities.findFirst({
          where: eq(guestIdentities.id, existing.guestIdentityId),
        });
        if (!guest) throw domainError("INTERNAL");
        return this.present(guest, actor);
      }
      const now = this.clock.now();
      const [guest] = await db.insert(guestIdentities).values({
        firstName,
        lastName,
        avatarKey: randomAvatarKey(randomBytes(1)[0]!),
        createdByUserId: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      }).returning();
      await db.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: "guest_identity.created",
        entityType: "guest_identity",
        entityId: guest!.id,
        meta: {
          newFirstName: firstName,
          newLastName: lastName,
          resultingVersion: guest!.version,
        },
        createdAt: now,
      });
      await db.insert(guestIdentityRequests).values({
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        operation: "create",
        guestIdentityId: guest!.id,
        requestFingerprint,
        resultingVersion: guest!.version,
        createdAt: now,
      });
      return this.present(guest!, actor);
    });
  }

  async rename(input: {
    actorUserId: string;
    requestId: string;
    guestId: string;
    expectedVersion: number;
    firstName: string;
    lastName: string;
  }) {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const requestFingerprint = fingerprint({
      operation: "rename",
      guestId: input.guestId,
      expectedVersion: input.expectedVersion,
      firstName,
      lastName,
    });
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const actor = await this.lockActor(input.actorUserId, db);
      const existing = await db.query.guestIdentityRequests.findFirst({
        where: and(
          eq(guestIdentityRequests.actorUserId, input.actorUserId),
          eq(guestIdentityRequests.requestId, input.requestId),
        ),
      });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw domainError("IDEMPOTENCY_KEY_REUSED");
        const guest = await db.query.guestIdentities.findFirst({
          where: eq(guestIdentities.id, existing.guestIdentityId),
        });
        if (!guest) throw domainError("INTERNAL");
        return this.present(guest, actor);
      }
      await this.lockGuest(input.guestId, db);
      const guest = await db.query.guestIdentities.findFirst({
        where: eq(guestIdentities.id, input.guestId),
      });
      if (!guest) throw domainError("NOT_FOUND");
      if (guest.createdByUserId !== actor.id && actor.role !== "admin") throw domainError("FORBIDDEN");
      if (guest.version !== input.expectedVersion) {
        throw Object.assign(domainError("VERSION_CONFLICT"), { state: { currentVersion: guest.version } });
      }
      const now = this.clock.now();
      const [updated] = await db.update(guestIdentities).set({
        firstName,
        lastName,
        version: guest.version + 1,
        updatedAt: now,
      }).where(and(
        eq(guestIdentities.id, input.guestId),
        eq(guestIdentities.version, input.expectedVersion),
      )).returning();
      if (!updated) throw domainError("VERSION_CONFLICT");
      await db.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: "guest_identity.renamed",
        entityType: "guest_identity",
        entityId: input.guestId,
        meta: {
          oldFirstName: guest.firstName,
          oldLastName: guest.lastName,
          newFirstName: firstName,
          newLastName: lastName,
          resultingVersion: updated.version,
        },
        createdAt: now,
      });
      await db.insert(guestIdentityRequests).values({
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        operation: "rename",
        guestIdentityId: input.guestId,
        requestFingerprint,
        resultingVersion: updated.version,
        createdAt: now,
      });
      return this.present(updated, actor);
    });
  }

  async get(actorUserId: string, guestId: string) {
    const [actor, guest] = await Promise.all([
      this.db.query.users.findFirst({ where: eq(users.id, actorUserId) }),
      this.db.query.guestIdentities.findFirst({ where: eq(guestIdentities.id, guestId) }),
    ]);
    if (!actor || actor.status !== "active") throw domainError("FORBIDDEN");
    return guest ? this.present(guest, actor) : null;
  }

  async mutationOutcome(actorUserId: string, requestId: string): Promise<GuestIdentityMutationOutcome> {
    const receipt = await this.db.query.guestIdentityRequests.findFirst({
      where: and(
        eq(guestIdentityRequests.actorUserId, actorUserId),
        eq(guestIdentityRequests.requestId, requestId),
      ),
    });
    return receipt ? {
      outcome: "committed",
      operation: receipt.operation as "create" | "rename",
      guestId: receipt.guestIdentityId,
      resultingVersion: receipt.resultingVersion,
    } : { outcome: "unknown" };
  }

  async list(actorUserId: string, query: { q?: string; cursor?: string; limit: number }) {
    const actor = await this.db.query.users.findFirst({ where: eq(users.id, actorUserId) });
    if (!actor || actor.status !== "active") throw domainError("FORBIDDEN");
    const q = query.q?.trim().toLocaleLowerCase("ru-RU") ?? "";
    const cursor = decodeCursor<CatalogueCursor>(query.cursor, (value): value is CatalogueCursor =>
      value.v === 1 && value.q === q && typeof value.lastName === "string" &&
      typeof value.firstName === "string" && typeof value.id === "string" && UUID_RE.test(value.id),
    );
    const pattern = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
    const result = await this.db.execute<typeof guestIdentities.$inferSelect>(sql`
      select id, first_name as "firstName", last_name as "lastName",
        avatar_key as "avatarKey", created_by_user_id as "createdByUserId",
        version, created_at as "createdAt", updated_at as "updatedAt"
      from guest_identities
      where (${pattern}::text is null or lower(concat_ws(' ', last_name, first_name)) ilike ${pattern} escape '\\')
        and (${cursor?.id ?? null}::uuid is null or (lower(last_name), lower(first_name), id) > (${cursor?.lastName ?? null}, ${cursor?.firstName ?? null}, ${cursor?.id ?? null}::uuid))
      order by lower(last_name), lower(first_name), id
      limit ${query.limit + 1}
    `);
    const rows = rowsOf(result as unknown as Array<typeof guestIdentities.$inferSelect> | { rows: Array<typeof guestIdentities.$inferSelect> });
    const page = rows.slice(0, query.limit);
    const guests = page.map((row) => this.present({
      ...row,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }, actor));
    const last = page.at(-1);
    return {
      guests,
      nextCursor: rows.length > query.limit && last ? encodeCursor({
        v: 1,
        q,
        lastName: last.lastName.toLocaleLowerCase("ru-RU"),
        firstName: last.firstName.toLocaleLowerCase("ru-RU"),
        id: last.id,
      }) : null,
    };
  }

  async history(actorUserId: string, guestId: string, cursorValue?: string) {
    const guest = await this.get(actorUserId, guestId);
    if (!guest) throw domainError("NOT_FOUND");
    const cursor = decodeCursor<HistoryCursor>(cursorValue, (value): value is HistoryCursor =>
      value.v === 1 && value.guestId === guestId &&
      (value.type === "match" || value.type === "tournament") &&
      typeof value.id === "string" && UUID_RE.test(value.id) &&
      typeof value.occurredAt === "string" && isValidCursorTimestamp(value.occurredAt),
    );
    const result = await this.db.execute<GuestHistoryRow>(sql`
      with guest_events as (
        select 'match'::text as event_type, m.id, m.title, m.status::text as status,
          coalesce(m.finished_at, m.updated_at, m.created_at) as occurred_at,
          case when m.status in ('finished', 'stopped') and mp.side = m.winner_side then 'win'
               when m.status in ('finished', 'stopped') and m.winner_side is not null then 'loss'
               else null end::text as result,
          m.kind::text as match_kind, m.score_a, m.score_b,
          sides.side_a, sides.side_b, m.format::text as format
        from match_participants mp
        join matches m on m.id = mp.match_id
        left join lateral (
          select
            string_agg(trim(concat_ws(' ', coalesce(u.last_name, p.guest_last_name), coalesce(u.first_name, p.guest_first_name))), ' / ' order by p.id) filter (where p.side = 'A') as side_a,
            string_agg(trim(concat_ws(' ', coalesce(u.last_name, p.guest_last_name), coalesce(u.first_name, p.guest_first_name))), ' / ' order by p.id) filter (where p.side = 'B') as side_b
          from match_participants p left join users u on u.id = p.user_id where p.match_id = m.id
        ) sides on true
        where mp.guest_identity_id = ${guestId}::uuid
          and m.kind <> 'tutorial'
          and m.status in ('finished', 'stopped', 'cancelled', 'voided')

        union all

        select 'tournament'::text, t.id, t.title, t.status::text,
          coalesce(t.finished_at, t.updated_at, t.created_at),
          case when t.status = 'finished' then
            case when tp.id::text = t.bracket_json->>'championParticipantId' then 'win' else 'loss' end
            else null end::text,
          null::text, null::integer, null::integer, null::text, null::text, t.format::text
        from tournament_participants tp
        join tournaments t on t.id = tp.tournament_id
        where tp.guest_identity_id = ${guestId}::uuid
          and tp.status = 'active'
          and t.status in ('finished', 'stopped', 'cancelled')
      )
      select guest_events.*,
        to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_occurred_at
      from guest_events
      where (${cursor?.occurredAt ?? null}::timestamptz is null or (occurred_at, event_type, id::text) < (${cursor?.occurredAt ?? null}::timestamptz, ${cursor?.type ?? null}, ${cursor?.id ?? null}))
      order by occurred_at desc, event_type desc, id desc
      limit 21
    `);
    const rows = rowsOf(result as unknown as GuestHistoryRow[] | { rows: GuestHistoryRow[] });
    const items = rows.slice(0, 20).map((row) => ({
      type: row.event_type,
      id: row.id,
      title: row.title,
      status: row.status,
      occurredAt: new Date(row.occurred_at).toISOString(),
      roles: ["player" as const],
      result: row.result,
      matchKind: row.match_kind,
      scoreA: row.score_a,
      scoreB: row.score_b,
      sideA: row.side_a,
      sideB: row.side_b,
      format: row.format,
    }));
    const lastRow = rows[19];
    return {
      guest,
      items,
      nextCursor: rows.length > 20 && lastRow ? encodeCursor({
        v: 1,
        guestId,
        occurredAt: lastRow.cursor_occurred_at,
        type: lastRow.event_type,
        id: lastRow.id,
      }) : null,
    };
  }
}
