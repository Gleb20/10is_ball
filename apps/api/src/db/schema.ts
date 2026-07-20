import { randomUUID } from "node:crypto";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const newId = () => randomUUID();

export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);
export const userStatusEnum = pgEnum("user_status", ["active", "blocked"]);
export const avatarSourceEnum = pgEnum("avatar_source", [
  "generated",
  "uploaded",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("user"),
    status: userStatusEnum("status").notNull().default("active"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    birthDate: text("birth_date"),
    organizationText: text("organization_text").default("Moscow transport"),
    positionText: text("position_text"),
    avatarSource: avatarSourceEnum("avatar_source")
      .notNull()
      .default("generated"),
    generatedAvatarKey: text("generated_avatar_key"),
    uploadedAvatarPath: text("uploaded_avatar_path"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  userAgent: text("user_agent"),
  ipFingerprint: text("ip_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokeReason: text("revoke_reason"),
});

export const temporaryPasswordIssues = pgTable("temporary_password_issues", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  issuedByAdminId: uuid("issued_by_admin_id")
    .notNull()
    .references(() => users.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const matchFormatEnum = pgEnum("match_format", ["1v1", "2v2"]);
export const matchStatusEnum = pgEnum("match_status", [
  "waiting",
  "in_progress",
  "pending_confirmation",
  "finished",
  "stopped",
  "cancelled",
]);
export const matchKindEnum = pgEnum("match_kind", [
  "standalone",
  "tournament",
  "tutorial",
]);

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  title: text("title").notNull(),
  kind: matchKindEnum("kind").notNull().default("standalone"),
  status: matchStatusEnum("status").notNull().default("waiting"),
  format: matchFormatEnum("format").notNull().default("1v1"),
  pointsToWin: integer("points_to_win").notNull().default(11),
  mercyEnabled: boolean("mercy_enabled").notNull().default(false),
  mercyPoints: integer("mercy_points"),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  tournamentId: uuid("tournament_id"),
  scoreA: integer("score_a").notNull().default(0),
  scoreB: integer("score_b").notNull().default(0),
  currentServerParticipantId: text("current_server_participant_id"),
  serveSequenceIndex: integer("serve_sequence_index").notNull().default(0),
  deuceMode: boolean("deuce_mode").notNull().default(false),
  version: integer("version").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  winnerSide: text("winner_side"),
  finishReason: text("finish_reason"),
  stopReasonCode: text("stop_reason_code"),
  stopReasonText: text("stop_reason_text"),
  eventLog: jsonb("event_log").notNull().default([]),
  idempotencyKeys: jsonb("idempotency_keys").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const matchParticipants = pgTable("match_participants", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  side: text("side").notNull(),
  userId: uuid("user_id").references(() => users.id),
  guestFirstName: text("guest_first_name"),
  guestLastName: text("guest_last_name"),
  isTutorialActor: boolean("is_tutorial_actor").notNull().default(false),
});

/** Active judge exclusivity enforced in app + SQL migration (partial unique). */
export const judgeSessions = pgTable("judge_sessions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  authSessionId: uuid("auth_session_id")
    .notNull()
    .references(() => authSessions.id),
  acquiredAt: timestamp("acquired_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});

export const tournaments = pgTable("tournaments", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  title: text("title").notNull(),
  status: text("status").notNull().default("collecting"),
  format: text("format").notNull().default("single_elimination"),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  defaultJudgeUserId: uuid("default_judge_user_id").references(() => users.id),
  bracketJson: jsonb("bracket_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const tournamentParticipants = pgTable("tournament_participants", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  tournamentId: uuid("tournament_id")
    .notNull()
    .references(() => tournaments.id),
  userId: uuid("user_id").references(() => users.id),
  guestFirstName: text("guest_first_name"),
  guestLastName: text("guest_last_name"),
  seed: integer("seed"),
  winsSnapshot: integer("wins_snapshot").notNull().default(0),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  slogan: text("slogan"),
  welcomeText: text("welcome_text"),
  captainUserId: uuid("captain_user_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const teamMemberships = pgTable("team_memberships", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  leaveReason: text("leave_reason"),
});

export const teamInvitations = pgTable("team_invitations", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id),
  invitedUserId: uuid("invited_user_id")
    .notNull()
    .references(() => users.id),
  invitedByUserId: uuid("invited_by_user_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  payload: jsonb("payload"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const faqArticles = pgTable("faq_articles", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  category: text("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const feedbackMessages = pgTable("feedback_messages", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userStats = pgTable("user_stats", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  winsAllTime: integer("wins_all_time").notNull().default(0),
  lossesAllTime: integer("losses_all_time").notNull().default(0),
  winsWeek: integer("wins_week").notNull().default(0),
  winsMonth: integer("wins_month").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
