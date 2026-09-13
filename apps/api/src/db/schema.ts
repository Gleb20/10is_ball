import { randomUUID } from "node:crypto";
import {
  boolean,
  check,
  integer,
  foreignKey,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
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
    onboardingStep: integer("onboarding_step").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    check(
      "users_onboarding_step_range",
      sql`${t.onboardingStep} BETWEEN 0 AND 6`,
    ),
  ],
);

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
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
  id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
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
  "voided",
]);
export const matchKindEnum = pgEnum("match_kind", [
  "standalone",
  "tournament",
  "tutorial",
]);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
    title: text("title").notNull(),
    kind: matchKindEnum("kind").notNull().default("standalone"),
    status: matchStatusEnum("status").notNull().default("waiting"),
    format: matchFormatEnum("format").notNull().default("1v1"),
    pointsToWin: integer("points_to_win").notNull().default(11),
    mercyEnabled: boolean("mercy_enabled").notNull().default(false),
    mercyPoints: integer("mercy_points"),
    firstServerMethod: text("first_server_method").notNull().default("manual"),
    source: text("source").notNull().default("manual"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    tournamentId: uuid("tournament_id"),
    tournamentSlotId: text("tournament_slot_id"),
    /** V2 bracket node id (e.g. W0_0); unique with tournament_id when set. */
    tournamentBracketMatchId: text("tournament_bracket_match_id"),
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
    judgeDisplayFlipped: boolean("judge_display_flipped")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("matches_tournament_bracket_match_uid")
      .on(t.tournamentId, t.tournamentBracketMatchId)
      .where(
        sql`${t.tournamentBracketMatchId} IS NOT NULL AND ${t.tournamentId} IS NOT NULL`,
      ),
  ],
);

export const matchParticipants = pgTable("match_participants", {
  id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  side: text("side").notNull(),
  userId: uuid("user_id").references(() => users.id),
  guestFirstName: text("guest_first_name"),
  guestLastName: text("guest_last_name"),
  guestAvatarKey: text("guest_avatar_key"),
  isTutorialActor: boolean("is_tutorial_actor").notNull().default(false),
});

export const matchInvitations = pgTable(
  "match_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
    matchId: uuid("match_id").notNull(),
    matchParticipantId: uuid("match_participant_id"),
    participantSide: text("participant_side"),
    invitedUserId: uuid("invited_user_id").notNull(),
    invitedByUserId: uuid("invited_by_user_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    expiryReason: text("expiry_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "match_invitations_match_id_fkey",
      columns: [table.matchId],
      foreignColumns: [matches.id],
    }),
    foreignKey({
      name: "match_invitations_invited_user_id_fkey",
      columns: [table.invitedUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "match_invitations_invited_by_user_id_fkey",
      columns: [table.invitedByUserId],
      foreignColumns: [users.id],
    }),
    check(
      "match_invitations_kind_check",
      sql`${table.kind} = ANY (ARRAY['player'::text, 'judge'::text])`,
    ),
    check(
      "match_invitations_status_check",
      sql`${table.status} = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text, 'cancelled'::text])`,
    ),
    check(
      "match_invitations_side_check",
      sql`(${table.matchParticipantId} IS NOT NULL AND ${table.participantSide} = ANY (ARRAY['A'::text, 'B'::text]) AND ${table.kind} = 'player') OR (${table.matchParticipantId} IS NULL AND ${table.participantSide} IS NULL AND ${table.kind} = 'judge')`,
    ),
    uniqueIndex("match_invitations_pending_user_kind_uid")
      .on(table.matchId, table.invitedUserId, table.kind)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("match_invitations_pending_participant_uid")
      .on(table.matchParticipantId)
      .where(
        sql`${table.kind} = 'player' AND ${table.status} = 'pending' AND ${table.matchParticipantId} IS NOT NULL`,
      ),
  ],
);

export const matchVoidAudits = pgTable(
  "match_void_audits",
  {
    id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: uuid("idempotency_key").notNull(),
    priorStatus: text("prior_status").notNull(),
    priorVersion: integer("prior_version").notNull(),
    priorResult: jsonb("prior_result").notNull(),
    priorEventLog: jsonb("prior_event_log").notNull(),
    reasonText: text("reason_text"),
    compensation: jsonb("compensation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("match_void_audits_match_uid").on(t.matchId),
    uniqueIndex("match_void_audits_idempotency_uid").on(
      t.matchId,
      t.actorUserId,
      t.idempotencyKey,
    ),
  ],
);

/** Active judge exclusivity enforced in app + SQL migration (partial unique). */
export const judgeSessions = pgTable(
  "judge_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
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
    reservedForUserId: uuid("reserved_for_user_id"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "judge_sessions_reserved_for_user_id_fkey", columns: [t.reservedForUserId], foreignColumns: [users.id] }),
    uniqueIndex("judge_sessions_active_user")
      .on(t.userId)
      .where(sql`${t.releasedAt} IS NULL AND ${t.reservedForUserId} IS NULL`),
    uniqueIndex("judge_sessions_reserved_user")
      .on(t.reservedForUserId)
      .where(sql`${t.releasedAt} IS NULL AND ${t.reservedForUserId} IS NOT NULL`),
    uniqueIndex("judge_sessions_active_match")
      .on(t.matchId)
      .where(sql`${t.releasedAt} IS NULL`),
  ],
);

export const tournaments = pgTable("tournaments", {
  id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
  title: text("title").notNull(),
  status: text("status").notNull().default("collecting"),
  format: text("format").notNull().default("single_elimination"),
  organizerParticipates: boolean("organizer_participates").notNull().default(true),
  pointsToWin: integer("points_to_win").notNull().default(11),
  mercyEnabled: boolean("mercy_enabled").notNull().default(true),
  mercyPoints: integer("mercy_points").default(5),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  defaultJudgeUserId: uuid("default_judge_user_id").references(() => users.id),
  bracketJson: jsonb("bracket_json"),
  /** Optimistic concurrency for bracket mutations (DB-only; not in JSON). */
  bracketStateVersion: integer("bracket_state_version").notNull().default(0),
  /**
   * NULL = legacy: topology from existing bracketJson.
   * true/false = explicit policy for new SE/DE generates.
   */
  thirdPlaceEnabled: boolean("third_place_enabled"),
  /**
   * Setting for the next generate. NULL = unclassified legacy (e.g. V1 DE).
   * Allowed: compact | power_of_two. Default for new rows: compact.
   */
  bracketConstructionAlgorithm: text("bracket_construction_algorithm"),
  stopReasonCode: text("stop_reason_code"),
  stopReasonText: text("stop_reason_text"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const tournamentParticipants = pgTable(
  "tournament_participants",
  {
    id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    userId: uuid("user_id").references(() => users.id),
    guestFirstName: text("guest_first_name"),
    guestLastName: text("guest_last_name"),
    guestAvatarKey: text("guest_avatar_key"),
    seed: integer("seed"),
    winsSnapshot: integer("wins_snapshot").notNull().default(0),
    status: text("status").notNull().default("active"),
  },
  (t) => [
    uniqueIndex("tournament_participants_active_user_uid")
      .on(t.tournamentId, t.userId)
      .where(sql`${t.userId} IS NOT NULL AND ${t.status} = 'active'`),
  ],
);

export const tournamentInvitations = pgTable(
  "tournament_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
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
  },
  (t) => [
    uniqueIndex("tournament_invitations_pending_user_uid")
      .on(t.tournamentId, t.invitedUserId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
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

export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    leaveReason: text("leave_reason"),
  },
  (t) => [
    uniqueIndex("team_memberships_active_user_uid")
      .on(t.teamId, t.userId)
      .where(sql`${t.leftAt} IS NULL`),
  ],
);

export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
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
  },
  (t) => [
    uniqueIndex("team_invitations_pending_user_uid")
      .on(t.teamId, t.invitedUserId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
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
  id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
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
  id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
  category: text("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const feedbackMessages = pgTable("feedback_messages", {
  id: uuid("id").primaryKey().defaultRandom().$defaultFn(newId),
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
