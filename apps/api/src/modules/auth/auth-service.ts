import { hash, verify } from "@node-rs/argon2";
import { and, count, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import {
  generateTemporaryPassword,
  normalizeEmail,
  randomAvatarKey,
  validatePassword,
} from "@tab10/shared";
import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "@tab10/test-utils";
import type { Db } from "../../db/client.js";
import {
  authSessions,
  auditLogs,
  notifications,
  temporaryPasswordIssues,
  users,
} from "../../db/schema.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 10;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const LOGIN_FAILURE_MAX_KEYS = 10_000;
const ARGON_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function isUniqueConstraintError(error: unknown, constraint: string): boolean {
  let current = error;
  while (current && typeof current === "object") {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "23505" && candidate.constraint === constraint) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return verify(passwordHash, password, ARGON_OPTS);
}

export type AuthUser = {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "active" | "blocked";
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
  avatarKey: string | null;
  onboardingStep: number;
  onboardingCompletedAt: Date | null;
};

export type OwnProfileUser = AuthUser & {
  birthDate: string | null;
  organizationText: string | null;
  positionText: string | null;
};

export type AdminUser = OwnProfileUser & {
  createdAt: Date;
  lastLoginAt: Date | null;
};

type LoginAttemptReservation = {
  key: string;
  resetAt: number;
};

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    firstName: row.firstName,
    lastName: row.lastName,
    mustChangePassword: row.mustChangePassword,
    avatarKey: row.generatedAvatarKey ?? null,
    onboardingStep: row.onboardingStep,
    onboardingCompletedAt: row.onboardingCompletedAt ?? null,
  };
}

function toOwnProfileUser(row: typeof users.$inferSelect): OwnProfileUser {
  return {
    ...toAuthUser(row),
    birthDate: row.birthDate ?? null,
    organizationText: row.organizationText ?? null,
    positionText: row.positionText ?? null,
  };
}

function toAdminUser(row: typeof users.$inferSelect): AdminUser {
  return {
    ...toOwnProfileUser(row),
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt ?? null,
  };
}

export class AuthService {
  // Deliberately process-local. Horizontal replicas need an accepted shared-store
  // design before this can be treated as a fleet-wide security boundary.
  private loginAttempts = new Map<string, { count: number; resetAt: number }>();
  private userBlockedHook?: (userId: string, db: Db) => Promise<void>;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  setUserBlockedHook(hook: (userId: string, db: Db) => Promise<void>): void {
    this.userBlockedHook = hook;
  }

  private rateLimitKey(email: string, ip: string): string {
    return createHash("sha256")
      .update(`${normalizeEmail(email)}\0${ip}`)
      .digest("hex");
  }

  private pruneExpiredLoginAttempts(now: number): void {
    for (const [key, entry] of this.loginAttempts) {
      if (entry.resetAt > now) break;
      this.loginAttempts.delete(key);
    }
  }

  private checkRateLimit(
    email: string,
    ip: string,
  ): LoginAttemptReservation | null {
    const key = this.rateLimitKey(email, ip);
    const now = this.clock.now().getTime();
    this.pruneExpiredLoginAttempts(now);
    const entry = this.loginAttempts.get(key);
    if (!entry) {
      if (this.loginAttempts.size >= LOGIN_FAILURE_MAX_KEYS) {
        const oldestKey = this.loginAttempts.keys().next().value;
        if (oldestKey !== undefined) this.loginAttempts.delete(oldestKey);
      }
      const resetAt = now + LOGIN_FAILURE_WINDOW_MS;
      this.loginAttempts.set(key, { count: 1, resetAt });
      return { key, resetAt };
    }
    if (entry.count >= LOGIN_FAILURE_LIMIT) return null;
    entry.count += 1;
    return { key, resetAt: entry.resetAt };
  }

  private releaseSuccessfulLogin(reservation: LoginAttemptReservation): void {
    const entry = this.loginAttempts.get(reservation.key);
    if (!entry || entry.resetAt !== reservation.resetAt) return;
    entry.count -= 1;
    if (entry.count === 0) this.loginAttempts.delete(reservation.key);
  }

  async createUser(input: {
    email: string;
    firstName: string;
    lastName: string;
    role: "admin" | "user";
    issuedByAdminId: string;
    birthDate?: string;
    organizationText?: string;
    positionText?: string;
  }): Promise<{ user: AuthUser; temporaryPassword: string }> {
    const email = normalizeEmail(input.email);
    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existing) {
      throw Object.assign(new Error("EMAIL_TAKEN"), { code: "EMAIL_TAKEN" });
    }

    const temporaryPassword = generateTemporaryPassword(16, () =>
      randomBytes(1)[0]!,
    );
    const passwordHash = await hashPassword(temporaryPassword);
    const avatarKey = randomAvatarKey(randomBytes(1)[0]!);

    let row: typeof users.$inferSelect | undefined;
    try {
      [row] = await this.db
        .insert(users)
        .values({
          email,
          passwordHash,
          role: input.role,
          firstName: input.firstName,
          lastName: input.lastName,
          birthDate: input.birthDate,
          organizationText: input.organizationText ?? "Moscow transport",
          positionText: input.positionText,
          mustChangePassword: true,
          generatedAvatarKey: avatarKey,
          avatarSource: "generated",
        })
        .returning();
    } catch (error) {
      if (isUniqueConstraintError(error, "users_email_unique")) {
        throw Object.assign(new Error("EMAIL_TAKEN"), { code: "EMAIL_TAKEN" });
      }
      throw error;
    }

    await this.db.insert(temporaryPasswordIssues).values({
      userId: row!.id,
      issuedByAdminId: input.issuedByAdminId,
    });

    await this.db.insert(auditLogs).values({
      actorUserId: input.issuedByAdminId,
      action: "user.created",
      entityType: "user",
      entityId: row!.id,
    });

    return { user: toAuthUser(row!), temporaryPassword };
  }

  async login(input: {
    email: string;
    password: string;
    ip: string;
    userAgent?: string;
  }): Promise<
    | { ok: true; user: AuthUser; sessionToken: string; sessionId: string }
    | { ok: false; code: string }
  > {
    const reservation = this.checkRateLimit(input.email, input.ip);
    if (!reservation) {
      return { ok: false, code: "RATE_LIMITED" };
    }
    try {
      const email = normalizeEmail(input.email);
      const user = await this.db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (!user) return { ok: false, code: "INVALID_CREDENTIALS" };
      if (user.status === "blocked") {
        return { ok: false, code: "ACCOUNT_BLOCKED" };
      }

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) return { ok: false, code: "INVALID_CREDENTIALS" };

      const token = randomBytes(32).toString("hex");
      const now = this.clock.now();
      const [session] = await this.db
        .insert(authSessions)
        .values({
          userId: user.id,
          tokenHash: hashToken(token),
          userAgent: input.userAgent,
          ipFingerprint: createHash("sha256")
            .update(input.ip)
            .digest("hex")
            .slice(0, 16),
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        })
        .returning();

      await this.db
        .update(users)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, user.id));

      this.releaseSuccessfulLogin(reservation);
      return {
        ok: true,
        user: toAuthUser(user),
        sessionToken: token,
        sessionId: session!.id,
      };
    } catch (error) {
      this.releaseSuccessfulLogin(reservation);
      throw error;
    }
  }

  async resolveSession(
    token: string | undefined,
  ): Promise<{ user: AuthUser; sessionId: string } | null> {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = await this.db.query.authSessions.findFirst({
      where: and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
      ),
    });
    if (!session) return null;
    const now = this.clock.now();
    if (session.expiresAt.getTime() <= now.getTime()) return null;

    const user = await this.db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    if (!user || user.status === "blocked") return null;

    // Sliding TTL
    const newExpiry = new Date(now.getTime() + SESSION_TTL_MS);
    await this.db
      .update(authSessions)
      .set({ lastSeenAt: now, expiresAt: newExpiry })
      .where(eq(authSessions.id, session.id));

    return { user: toAuthUser(user), sessionId: session.id };
  }

  async changePasswordFirst(input: {
    userId: string;
    sessionId: string;
    newPassword: string;
  }): Promise<{ ok: true } | { ok: false; code: string; errors?: string[] }> {
    const policy = validatePassword(input.newPassword);
    if (!policy.ok) {
      return { ok: false, code: "PASSWORD_POLICY", errors: policy.errors };
    }
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, input.userId),
    });
    if (!user || !user.mustChangePassword) {
      return { ok: false, code: "NOT_REQUIRED" };
    }
    const passwordHash = await hashPassword(input.newPassword);
    const now = this.clock.now();
    await this.db
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        updatedAt: now,
      })
      .where(eq(users.id, input.userId));

    await this.db
      .update(temporaryPasswordIssues)
      .set({ consumedAt: now })
      .where(
        and(
          eq(temporaryPasswordIssues.userId, input.userId),
          isNull(temporaryPasswordIssues.consumedAt),
        ),
      );

    // Rotate: revoke other sessions, keep current
    await this.db
      .update(authSessions)
      .set({ revokedAt: now, revokeReason: "password_change" })
      .where(
        and(
          eq(authSessions.userId, input.userId),
          ne(authSessions.id, input.sessionId),
          isNull(authSessions.revokedAt),
        ),
      );

    return { ok: true };
  }

  async changePassword(input: {
    userId: string;
    sessionId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: true } | { ok: false; code: string; errors?: string[] }> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, input.userId),
    });
    if (!user) return { ok: false, code: "NOT_FOUND" };
    const valid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!valid) return { ok: false, code: "INVALID_CREDENTIALS" };
    const policy = validatePassword(input.newPassword);
    if (!policy.ok) {
      return { ok: false, code: "PASSWORD_POLICY", errors: policy.errors };
    }
    const passwordHash = await hashPassword(input.newPassword);
    const now = this.clock.now();
    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, input.userId));
    await this.db
      .update(authSessions)
      .set({ revokedAt: now, revokeReason: "password_change" })
      .where(
        and(
          eq(authSessions.userId, input.userId),
          ne(authSessions.id, input.sessionId),
          isNull(authSessions.revokedAt),
        ),
      );
    return { ok: true };
  }

  async logout(sessionId: string): Promise<void> {
    const now = this.clock.now();
    await this.db
      .update(authSessions)
      .set({ revokedAt: now, revokeReason: "logout" })
      .where(eq(authSessions.id, sessionId));
  }

  async listSessions(userId: string) {
    return this.db.query.authSessions.findMany({
      where: and(
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, this.clock.now()),
      ),
    });
  }

  async revokeSession(userId: string, sessionId: string, currentSessionId?: string): Promise<boolean> {
    if (sessionId === currentSessionId) {
      throw Object.assign(new Error("CURRENT_SESSION_FORBIDDEN"), { code: "CURRENT_SESSION_FORBIDDEN" });
    }
    const now = this.clock.now();
    const result = await this.db
      .update(authSessions)
      .set({ revokedAt: now, revokeReason: "user_revoke" })
      .where(
        and(
          eq(authSessions.id, sessionId),
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
        ),
      )
      .returning();
    return result.length > 0;
  }

  async revokeAllSessions(userId: string, reason: string): Promise<void> {
    const now = this.clock.now();
    await this.db
      .update(authSessions)
      .set({ revokedAt: now, revokeReason: reason })
      .where(
        and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)),
      );
  }

  private async lockAdminMutationUsers(
    adminId: string,
    userId: string,
    db: Db,
  ) {
    const lockedUsers = await db
      .select()
      .from(users)
      .where(
        or(
          and(eq(users.role, "admin"), eq(users.status, "active")),
          inArray(users.id, [...new Set([adminId, userId])]),
        ),
      )
      .orderBy(users.id)
      .for("update");
    const activeAdmins = lockedUsers.filter(
      (candidate) =>
        candidate.role === "admin" && candidate.status === "active",
    );
    const target = lockedUsers.find((candidate) => candidate.id === userId);
    if (!target) {
      throw Object.assign(new Error("USER_NOT_FOUND"), {
        code: "USER_NOT_FOUND",
      });
    }
    return {
      activeAdmins,
      actorIsActiveAdmin: activeAdmins.some(
        (candidate) => candidate.id === adminId,
      ),
      target,
    };
  }

  async blockUser(adminId: string, userId: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const { activeAdmins, actorIsActiveAdmin, target } =
        await this.lockAdminMutationUsers(adminId, userId, db);
      if (!actorIsActiveAdmin) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      if (target.status === "blocked") return;
      if (target.role === "admin" && activeAdmins.length === 1) {
        throw Object.assign(new Error("LAST_ADMIN"), { code: "LAST_ADMIN" });
      }
      if (adminId === userId) {
        throw Object.assign(new Error("SELF_BLOCK_FORBIDDEN"), {
          code: "SELF_BLOCK_FORBIDDEN",
        });
      }
      const now = this.clock.now();
      await db.update(users).set({ status: "blocked", blockedAt: now, updatedAt: now }).where(eq(users.id, userId));
      await db.update(authSessions).set({ revokedAt: now, revokeReason: "blocked" }).where(
        and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)),
      );
      await db.insert(auditLogs).values({
        actorUserId: adminId,
        action: "user.blocked",
        entityType: "user",
        entityId: userId,
      });
      await this.userBlockedHook?.(userId, db);
      await db.insert(notifications).values({
        userId,
        type: "account_access_changed",
        title: "Доступ к аккаунту изменён",
        body: "Аккаунт заблокирован администратором",
        payload: { change: "blocked" },
      });
    });
  }

  async unblockUser(adminId: string, userId: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const { actorIsActiveAdmin, target } =
        await this.lockAdminMutationUsers(adminId, userId, db);
      if (!actorIsActiveAdmin) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      if (target.status === "active") return;
      const now = this.clock.now();
      await db
        .update(users)
        .set({ status: "active", blockedAt: null, updatedAt: now })
        .where(eq(users.id, userId));
      await db.insert(auditLogs).values({
        actorUserId: adminId,
        action: "user.unblocked",
        entityType: "user",
        entityId: userId,
      });
      await db.insert(notifications).values({
        userId,
        type: "account_access_changed",
        title: "Доступ к аккаунту изменён",
        body: "Аккаунт разблокирован администратором",
        payload: { change: "unblocked" },
      });
    });
  }

  async resetPassword(
    adminId: string,
    userId: string,
  ): Promise<{ temporaryPassword: string }> {
    const temporaryPassword = generateTemporaryPassword(16, () =>
      randomBytes(1)[0]!,
    );
    const passwordHash = await hashPassword(temporaryPassword);
    await this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const { actorIsActiveAdmin } = await this.lockAdminMutationUsers(
        adminId,
        userId,
        db,
      );
      if (!actorIsActiveAdmin) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      const now = this.clock.now();
      await db
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: true,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
      await db
        .update(authSessions)
        .set({ revokedAt: now, revokeReason: "password_reset" })
        .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
      await db.insert(temporaryPasswordIssues).values({
        userId,
        issuedByAdminId: adminId,
      });
      await db.insert(auditLogs).values({
        actorUserId: adminId,
        action: "user.password_reset",
        entityType: "user",
        entityId: userId,
      });
      await db.insert(notifications).values({
        userId,
        type: "account_access_changed",
        title: "Доступ к аккаунту изменён",
        body: "Администратор сбросил пароль аккаунта",
        payload: { change: "password_reset" },
      });
    });
    return { temporaryPassword };
  }

  async updateUserRole(
    actorAdminId: string,
    userId: string,
    role: "admin" | "user",
  ): Promise<AuthUser> {
    return this.updateAdminUser(actorAdminId, userId, { role });
  }

  async updateAdminUser(
    actorAdminId: string,
    userId: string,
    patch: Partial<{
      firstName: string;
      lastName: string;
      birthDate: string | null;
      organizationText: string | null;
      positionText: string | null;
      role: "admin" | "user";
    }>,
  ): Promise<AdminUser> {
    if (userId === actorAdminId) {
      if (patch.role !== undefined) {
        throw Object.assign(new Error("SELF_ROLE_CHANGE_FORBIDDEN"), {
          code: "SELF_ROLE_CHANGE_FORBIDDEN",
        });
      }
    }
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const { activeAdmins, actorIsActiveAdmin, target } =
        await this.lockAdminMutationUsers(actorAdminId, userId, db);
      const roleChanged = patch.role !== undefined && target.role !== patch.role;
      if (
        roleChanged &&
        target.role === "admin" &&
        target.status === "active" &&
        patch.role === "user" &&
        activeAdmins.length === 1
      ) {
        throw Object.assign(new Error("LAST_ADMIN"), { code: "LAST_ADMIN" });
      }
      if (!actorIsActiveAdmin) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      const changedFields = Object.keys(patch).filter((field) => {
        if (field === "role") return roleChanged;
        return target[field as keyof typeof target] !== patch[field as keyof typeof patch];
      });
      if (changedFields.length === 0) {
        return toAdminUser(target);
      }
      const now = this.clock.now();
      const [row] = await db
        .update(users)
        .set({
          ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
          ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
          ...(patch.birthDate !== undefined ? { birthDate: patch.birthDate } : {}),
          ...(patch.organizationText !== undefined
            ? { organizationText: patch.organizationText }
            : {}),
          ...(patch.positionText !== undefined
            ? { positionText: patch.positionText }
            : {}),
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .returning();
      if (roleChanged) {
        await db
          .update(authSessions)
          .set({ revokedAt: now, revokeReason: "role_changed" })
          .where(
            and(
              eq(authSessions.userId, userId),
              isNull(authSessions.revokedAt),
            ),
          );
      }
      await db.insert(auditLogs).values({
        actorUserId: actorAdminId,
        action: roleChanged ? "user.role_changed" : "user.updated",
        entityType: "user",
        entityId: userId,
        meta: { changedFields },
      });
      if (roleChanged) {
        await db.insert(notifications).values({
          userId,
          type: "account_access_changed",
          title: "Доступ к аккаунту изменён",
          body: "Администратор изменил роль аккаунта",
          payload: { change: "role_changed", role: patch.role },
        });
      }
      return toAdminUser(row!);
    });
  }

  async ensureNotLastAdmin(userId: string): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user || user.role !== "admin") return;
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          eq(users.role, "admin"),
          eq(users.status, "active"),
          ne(users.id, userId),
        ),
      );
    if (Number(value) === 0) {
      throw Object.assign(new Error("LAST_ADMIN"), { code: "LAST_ADMIN" });
    }
  }

  async listUsers(q?: string) {
    const all = await this.db.select().from(users).orderBy(users.lastName, users.firstName);
    if (!q) return all;
    const needle = q.toLowerCase();
    return all.filter(
      (u) =>
        u.email.includes(needle) ||
        u.firstName.toLowerCase().includes(needle) ||
        u.lastName.toLowerCase().includes(needle),
    );
  }

  async listAdminUsers(opts: {
    q?: string;
    status?: "active" | "blocked";
  } = {}): Promise<AdminUser[]> {
    const all = await this.db
      .select()
      .from(users)
      .orderBy(users.lastName, users.firstName);
    const needle = opts.q?.toLowerCase();
    return all
      .filter(
        (user) =>
          (!opts.status || user.status === opts.status) &&
          (!needle ||
            user.email.toLowerCase().includes(needle) ||
            user.firstName.toLowerCase().includes(needle) ||
            user.lastName.toLowerCase().includes(needle)),
      )
      .map(toAdminUser);
  }

  /** Public directory for opponent/participant pickers (no email/admin fields). */
  async listDirectory(opts: { q?: string; excludeUserId?: string } = {}) {
    const all = await this.listUsers(opts.q);
    return all
      .filter(
        (u) =>
          u.status === "active" &&
          (!opts.excludeUserId || u.id !== opts.excludeUserId) &&
          // Hide load-test synthetics (displayName would be "User Load")
          !/^load\d*@tab10\.local$/i.test(u.email),
      )
      .map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        displayName: `${u.lastName} ${u.firstName}`,
        avatarKey: u.generatedAvatarKey ?? null,
      }));
  }

  async updateProfile(
    userId: string,
    patch: Partial<{
      firstName: string;
      lastName: string;
      birthDate: string | null;
      organizationText: string | null;
      positionText: string | null;
      onboardingCompletedAt: Date | null;
    }>,
  ): Promise<OwnProfileUser> {
    const now = this.clock.now();
    const [row] = await this.db
      .update(users)
      .set({ ...patch, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();
    return toOwnProfileUser(row!);
  }

  async updateOnboarding(
    userId: string,
    input:
      | { action: "set-step"; step: number }
      | { action: "complete" }
      | { action: "restart" },
  ): Promise<AuthUser> {
    const now = this.clock.now();
    const patch =
      input.action === "set-step"
        ? { onboardingStep: input.step, updatedAt: now }
        : input.action === "complete"
          ? {
              onboardingStep: 6,
              onboardingCompletedAt: now,
              updatedAt: now,
            }
          : {
              onboardingStep: 0,
              onboardingCompletedAt: null,
              updatedAt: now,
            };
    const [row] = await this.db
      .update(users)
      .set(patch)
      .where(eq(users.id, userId))
      .returning();
    return toAuthUser(row!);
  }

  async seedAdmin(
    email: string,
    password: string,
  ): Promise<{ user: AuthUser; created: boolean }> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, normalizeEmail(email)),
    });
    if (existing) return { user: toAuthUser(existing), created: false };
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          email: normalizeEmail(email),
          passwordHash,
          role: "admin",
          firstName: "Admin",
          lastName: "Tab10",
          mustChangePassword: false,
          generatedAvatarKey: "avatar_1",
        })
        .onConflictDoNothing({ target: users.email })
        .returning();

      if (!row) {
        const concurrent = await tx.query.users.findFirst({
          where: eq(users.email, normalizeEmail(email)),
        });
        if (!concurrent) {
          throw new Error("Bootstrap admin conflict did not yield an account");
        }
        return { user: toAuthUser(concurrent), created: false };
      }

      await tx.insert(auditLogs).values({
        actorUserId: null,
        action: "admin.bootstrap_provisioned",
        entityType: "user",
        entityId: row.id,
        meta: { source: "startup-bootstrap" },
      });
      return { user: toAuthUser(row), created: true };
    });
  }
}
