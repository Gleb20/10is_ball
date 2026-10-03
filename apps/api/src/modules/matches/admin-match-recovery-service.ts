import { eq, sql } from "drizzle-orm";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import { matches, users } from "../../db/schema.js";
import { MatchService } from "./match-service.js";

type MatchRow = typeof matches.$inferSelect;

export type AdminMatchRecovery = Pick<
  MatchRow,
  "id" | "kind" | "status" | "version"
> & {
  allowedEmergencyAction: "force_close" | null;
};

type RecoveryErrorCode =
  | "FORBIDDEN"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "INTERNAL"
  | "MATCH_NOT_ACTIVE"
  | "NOT_FOUND"
  | "TOURNAMENT_MATCH_FORBIDDEN"
  | "VALIDATION"
  | "VERSION_CONFLICT";

const RECOVERY_ERROR: Record<
  RecoveryErrorCode,
  { status: number; message: string }
> = {
  FORBIDDEN: { status: 403, message: "Только для активного администратора" },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    message: "Нужен заголовок Idempotency-Key",
  },
  INTERNAL: { status: 500, message: "Внутренняя ошибка сервера" },
  MATCH_NOT_ACTIVE: {
    status: 400,
    message: "Аварийное завершение недоступно для этого матча",
  },
  NOT_FOUND: { status: 404, message: "Матч не найден" },
  TOURNAMENT_MATCH_FORBIDDEN: {
    status: 400,
    message: "Аварийное завершение недоступно для этого матча",
  },
  VALIDATION: { status: 400, message: "Некорректные данные запроса" },
  VERSION_CONFLICT: {
    status: 409,
    message: "Состояние матча изменилось. Сверьте его перед повтором",
  },
};

function errorCode(error: unknown): RecoveryErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code in RECOVERY_ERROR
    ? (code as RecoveryErrorCode)
    : "INTERNAL";
}

function sanitizedRecoveryError(error: unknown) {
  const code = errorCode(error);
  return Object.assign(new Error(code), { code });
}

export function adminMatchRecoveryHttpError(error: unknown): {
  status: number;
  body: { code: RecoveryErrorCode; message: string };
} {
  const code = errorCode(error);
  return { status: RECOVERY_ERROR[code].status, body: { code, message: RECOVERY_ERROR[code].message } };
}

function project(match: Pick<MatchRow, "id" | "kind" | "status" | "version">): AdminMatchRecovery {
  const allowedEmergencyAction =
    match.kind === "standalone" &&
    (match.status === "waiting" ||
      match.status === "in_progress" ||
      match.status === "pending_confirmation")
      ? "force_close"
      : null;
  return {
    id: match.id,
    kind: match.kind,
    status: match.status,
    version: match.version,
    allowedEmergencyAction,
  };
}

export class AdminMatchRecoveryService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private async assertActiveAdmin(db: Db, actorAdminId: string) {
    const actor = await db.query.users.findFirst({
      where: eq(users.id, actorAdminId),
      columns: { id: true, role: true, status: true },
    });
    if (!actor || actor.role !== "admin" || actor.status !== "active") {
      throw sanitizedRecoveryError({ code: "FORBIDDEN" });
    }
  }

  async lookup(matchId: string, actorAdminId: string): Promise<AdminMatchRecovery> {
    await this.assertActiveAdmin(this.db, actorAdminId);
    const [match] = await this.db
      .select({
        id: matches.id,
        kind: matches.kind,
        status: matches.status,
        version: matches.version,
      })
      .from(matches)
      .where(eq(matches.id, matchId));
    if (!match) throw sanitizedRecoveryError({ code: "NOT_FOUND" });
    return project(match);
  }

  async forceClose(input: {
    matchId: string;
    actorAdminId: string;
    expectedVersion: number;
    idempotencyKey: string;
    reasonText?: string;
  }): Promise<AdminMatchRecovery> {
    try {
      return await this.db.transaction(async (transaction) => {
        const db = transaction as unknown as Db;
        await db.execute(
          sql`select ${matches.id} from ${matches} where ${matches.id} = ${input.matchId} for update`,
        );
        await db.execute(
          sql`select ${users.id} from ${users} where ${users.id} = ${input.actorAdminId} for update`,
        );
        await this.assertActiveAdmin(db, input.actorAdminId);
        const match = await new MatchService(db, this.clock).adminForceCloseMatch(
          input,
        );
        return project(match);
      });
    } catch (error) {
      throw sanitizedRecoveryError(error);
    }
  }
}
