import { z } from "zod";

export const UserRoleSchema = z.enum(["admin", "user"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserStatusSchema = z.enum(["active", "blocked"]);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const MatchFormatSchema = z.enum(["1v1", "2v2"]);
export type MatchFormat = z.infer<typeof MatchFormatSchema>;

export const MatchStatusSchema = z.enum([
  "waiting",
  "in_progress",
  "pending_confirmation",
  "finished",
  "stopped",
  "cancelled",
  "voided",
]);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

export const MatchKindSchema = z.enum(["standalone", "tournament", "tutorial"]);
export type MatchKind = z.infer<typeof MatchKindSchema>;

export const SideSchema = z.enum(["A", "B"]);
export type Side = z.infer<typeof SideSchema>;

export const FirstServerMethodSchema = z.enum(["random", "manual", "rally"]);
export type FirstServerMethod = z.infer<typeof FirstServerMethodSchema>;

export const MatchParticipantRequestSchema = z
  .object({
    side: SideSchema,
    userId: z.string().uuid().optional(),
    guestFirstName: z.string().trim().min(1).max(100).optional(),
    guestLastName: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((participant, ctx) => {
    const isUser = participant.userId !== undefined;
    const isGuest =
      participant.guestFirstName !== undefined ||
      participant.guestLastName !== undefined;
    if (isUser === isGuest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "participant must be exactly one of registered user or guest",
      });
    }
    if (isGuest && (!participant.guestFirstName || !participant.guestLastName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "guest first and last name are required",
      });
    }
  });

export const CreateMatchRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    format: MatchFormatSchema,
    pointsToWin: z.number().int().min(1).optional(),
    mercyEnabled: z.boolean().optional(),
    mercyPoints: z.number().int().min(1).nullable().optional(),
    firstServerMethod: FirstServerMethodSchema.optional(),
    source: z.enum(["manual", "challenge", "revenge", "tutorial"]).optional(),
    participants: z.array(MatchParticipantRequestSchema).max(4),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.mercyEnabled && request.mercyPoints == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mercyPoints"],
        message: "positive mercyPoints is required when mercy is enabled",
      });
    }
  });
export type CreateMatchRequest = z.infer<typeof CreateMatchRequestSchema>;

export const StartMatchRequestSchema = z
  .object({ firstServerParticipantId: z.string().uuid().optional() })
  .strict()
  .default({});

export const JudgeSetupRequestSchema = z
  .object({
    firstServerParticipantId: z.string().uuid().optional(),
    swapSides: z.boolean().optional(),
    displayFlipped: z.boolean().optional(),
  })
  .strict()
  .default({});

export const MatchVersionRequestSchema = z
  .object({ expectedVersion: z.number().int().min(0) })
  .strict();

export const CancelMatchRequestSchema = MatchVersionRequestSchema.extend({
  reasonText: z.string().trim().max(500).optional(),
}).strict();
export type CancelMatchRequest = z.infer<typeof CancelMatchRequestSchema>;

export const AwardPointRequestSchema = MatchVersionRequestSchema.extend({
  side: SideSchema,
}).strict();

export const NoShowRequestSchema = MatchVersionRequestSchema.extend({
  absentSide: SideSchema,
  reasonText: z.string().trim().max(500).optional(),
}).strict();

export const JudgeHandoverRequestSchema = z
  .object({ toUserId: z.string().uuid() })
  .strict();

export const ManualCorrectionRequestSchema = MatchVersionRequestSchema.extend({
  scoreA: z.number().int().min(0).max(999),
  scoreB: z.number().int().min(0).max(999),
  currentServerParticipantId: z.string().uuid(),
}).strict();

export const StopMatchRequestSchema = z
  .object({
    winnerSide: SideSchema,
    reasonCode: z.enum(["injury", "time", "other"]),
    reasonText: z.string().trim().max(500).optional(),
  })
  .strict();

export const TournamentStatusSchema = z.enum([
  "collecting",
  "bracket_generated",
  "needs_regeneration",
  "in_progress",
  "finished",
  "stopped",
]);
export type TournamentStatus = z.infer<typeof TournamentStatusSchema>;

export const TournamentFormatSchema = z.enum([
  "single_elimination",
  "double_elimination",
]);
export type TournamentFormat = z.infer<typeof TournamentFormatSchema>;

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const CreateUserRequestSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: UserRoleSchema.default("user"),
  birthDate: z.string().optional(),
  organizationText: z.string().optional(),
  positionText: z.string().optional(),
});

export * from "./password-policy.js";
export * from "./match-engine.js";
export * from "./tournament-bracket.js";
export * from "./ranking.js";
export * from "./team-rules.js";
export * from "./avatars.js";
export * from "./release-metadata.js";
