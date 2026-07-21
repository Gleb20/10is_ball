import { hash, verify } from "@node-rs/argon2";
import { and, count, eq, gt, isNull, ne } from "drizzle-orm";
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
  temporaryPasswordIssues,
  users,
} from "../../db/schema.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ARGON_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

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
  };
}

export class AuthService {
  private loginAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private rateLimitKey(email: string, ip: string): string {
    return `${normalizeEmail(email)}|${ip}`;
  }

  checkRateLimit(email: string, ip: string): boolean {
    const key = this.rateLimitKey(email, ip);
    const now = this.clock.now().getTime();
    const entry = this.loginAttempts.get(key);
    if (!entry || entry.resetAt < now) {
      this.loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
      return true;
    }
    if (entry.count >= 10) return false;
    entry.count += 1;
    return true;
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

    const [row] = await this.db
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
    if (!this.checkRateLimit(input.email, input.ip)) {
      return { ok: false, code: "RATE_LIMITED" };
    }
    const email = normalizeEmail(input.email);
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (!user) return { ok: false, code: "INVALID_CREDENTIALS" };
    if (user.status === "blocked") return { ok: false, code: "ACCOUNT_BLOCKED" };

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
        ipFingerprint: createHash("sha256").update(input.ip).digest("hex").slice(0, 16),
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      })
      .returning();

    await this.db
      .update(users)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, user.id));

    return {
      ok: true,
      user: toAuthUser(user),
      sessionToken: token,
      sessionId: session!.id,
    };
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

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
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

  async blockUser(adminId: string, userId: string): Promise<void> {
    await this.ensureNotLastAdmin(userId);
    const now = this.clock.now();
    await this.db
      .update(users)
      .set({ status: "blocked", blockedAt: now, updatedAt: now })
      .where(eq(users.id, userId));
    await this.revokeAllSessions(userId, "blocked");
    await this.db.insert(auditLogs).values({
      actorUserId: adminId,
      action: "user.blocked",
      entityType: "user",
      entityId: userId,
    });
  }

  async unblockUser(adminId: string, userId: string): Promise<void> {
    const now = this.clock.now();
    await this.db
      .update(users)
      .set({ status: "active", blockedAt: null, updatedAt: now })
      .where(eq(users.id, userId));
    await this.db.insert(auditLogs).values({
      actorUserId: adminId,
      action: "user.unblocked",
      entityType: "user",
      entityId: userId,
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
    const now = this.clock.now();
    await this.db
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: true,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
    await this.revokeAllSessions(userId, "password_reset");
    await this.db.insert(temporaryPasswordIssues).values({
      userId,
      issuedByAdminId: adminId,
    });
    await this.db.insert(auditLogs).values({
      actorUserId: adminId,
      action: "user.password_reset",
      entityType: "user",
      entityId: userId,
    });
    return { temporaryPassword };
  }

  async updateUserRole(
    actorAdminId: string,
    userId: string,
    role: "admin" | "user",
  ): Promise<AuthUser> {
    if (userId === actorAdminId) {
      throw Object.assign(new Error("SELF_ROLE_CHANGE_FORBIDDEN"), {
        code: "SELF_ROLE_CHANGE_FORBIDDEN",
      });
    }
    const target = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!target) {
      throw Object.assign(new Error("USER_NOT_FOUND"), {
        code: "USER_NOT_FOUND",
      });
    }
    if (target.role === role) {
      return toAuthUser(target);
    }
    if (target.role === "admin" && role === "user") {
      await this.ensureNotLastAdmin(userId);
    }
    const now = this.clock.now();
    const [row] = await this.db
      .update(users)
      .set({ role, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();
    await this.revokeAllSessions(userId, "role_changed");
    await this.db.insert(auditLogs).values({
      actorUserId: actorAdminId,
      action: "user.role_changed",
      entityType: "user",
      entityId: userId,
    });
    return toAuthUser(row!);
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

  /** Public directory for opponent/participant pickers (no email/admin fields). */
  async listDirectory(opts: { q?: string; excludeUserId?: string } = {}) {
    const all = await this.listUsers(opts.q);
    return all
      .filter(
        (u) =>
          u.status === "active" &&
          (!opts.excludeUserId || u.id !== opts.excludeUserId),
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
  ) {
    const now = this.clock.now();
    const [row] = await this.db
      .update(users)
      .set({ ...patch, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();
    return row;
  }

  async seedAdmin(email: string, password: string): Promise<AuthUser> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, normalizeEmail(email)),
    });
    if (existing) return toAuthUser(existing);
    const passwordHash = await hashPassword(password);
    const [row] = await this.db
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
      .returning();
    return toAuthUser(row!);
  }
}
