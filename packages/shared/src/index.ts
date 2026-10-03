import { z } from "zod";
import { isAvatarKey, type AvatarKey } from "./avatars.js";

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

const MatchParticipantFieldsSchema = z
  .object({
    side: SideSchema,
    userId: z.string().uuid().optional(),
    guestFirstName: z.string().trim().min(1).max(100).optional(),
    guestLastName: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const validateMatchParticipant = (participant: z.infer<typeof MatchParticipantFieldsSchema>, ctx: z.RefinementCtx) => {
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
  };

export const MatchParticipantRequestSchema = MatchParticipantFieldsSchema.superRefine(validateMatchParticipant);
const UpdateMatchParticipantRequestSchema = MatchParticipantFieldsSchema.extend({ id: z.string().uuid().optional() }).superRefine(validateMatchParticipant);

const CreateMatchFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    format: MatchFormatSchema,
    pointsToWin: z.number().int().min(1).optional(),
    mercyEnabled: z.boolean().optional(),
    mercyPoints: z.number().int().min(1).nullable().optional(),
    firstServerMethod: FirstServerMethodSchema.optional(),
    source: z.enum(["manual", "challenge", "revenge", "tutorial"]).optional(),
    sendPlayerInvitations: z.boolean().optional(),
    participants: z.array(MatchParticipantRequestSchema).max(4),
    judgeUserId: z.string().uuid().optional(),
  })
  .strict();

export const CreateMatchRequestSchema = CreateMatchFieldsSchema.superRefine((request, ctx) => {
    if (request.mercyEnabled && request.mercyPoints == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mercyPoints"],
        message: "positive mercyPoints is required when mercy is enabled",
      });
    }
  });
export type CreateMatchRequest = z.infer<typeof CreateMatchRequestSchema>;

export const UpdateMatchRequestSchema = CreateMatchFieldsSchema
  .omit({ source: true, judgeUserId: true, sendPlayerInvitations: true })
  .partial()
  .extend({ participants: z.array(UpdateMatchParticipantRequestSchema).max(4).optional() })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "At least one field is required");
export type UpdateMatchRequest = z.infer<typeof UpdateMatchRequestSchema>;
export const MatchInvitationRequestSchema = z.object({
  userId: z.string().uuid(), kind: z.enum(["player", "judge"]),
}).strict();

export const StartMatchRequestSchema = z
  .object({ firstServerParticipantId: z.string().uuid().optional() })
  .strict()
  .default({});

export const MatchLaunchSlotSchema = z.enum(["A1", "A2", "B1", "B2"]);
export type MatchLaunchSlot = z.infer<typeof MatchLaunchSlotSchema>;

const MatchLaunchParticipantSchema = z
  .object({
    userId: z.string().uuid().optional(),
    guestIdentityId: z.string().uuid().optional(),
    guestFirstName: z.string().trim().min(1).max(100).optional(),
    guestLastName: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((participant, ctx) => {
    const isUser = participant.userId !== undefined;
    const isGuestIdentity = participant.guestIdentityId !== undefined;
    const isInlineGuest =
      participant.guestFirstName !== undefined ||
      participant.guestLastName !== undefined;
    if (Number(isUser) + Number(isGuestIdentity) + Number(isInlineGuest) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "launch participant must be exactly one registered user, reusable guest or inline guest",
      });
    }
    if (
      isInlineGuest &&
      (!participant.guestFirstName || !participant.guestLastName)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "inline guest first and last name are required",
      });
    }
  });

const MatchLaunchRosterSchema = z
  .object({
    A1: MatchLaunchParticipantSchema,
    A2: MatchLaunchParticipantSchema.optional(),
    B1: MatchLaunchParticipantSchema,
    B2: MatchLaunchParticipantSchema.optional(),
  })
  .strict();

const MatchLaunchRequestFieldsSchema = z
  .object({
    requestId: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    format: MatchFormatSchema,
    pointsToWin: z.number().int().min(1).optional(),
    mercyEnabled: z.boolean().optional(),
    mercyPoints: z.number().int().min(1).nullable().optional(),
    firstServerMethod: FirstServerMethodSchema,
    firstServerSlot: MatchLaunchSlotSchema.optional(),
    roster: MatchLaunchRosterSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    const { roster } = request;
    if (request.format === "1v1" && (roster.A2 || roster.B2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roster"],
        message: "1v1 permits only A1 and B1",
      });
    }
    if (request.format === "2v2" && (!roster.A2 || !roster.B2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roster"],
        message: "2v2 requires A1, A2, B1 and B2",
      });
    }
    if (request.firstServerMethod === "random" && request.firstServerSlot) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["firstServerSlot"],
        message: "random first-server selection forbids a slot",
      });
    }
    if (
      request.firstServerMethod !== "random" &&
      !request.firstServerSlot
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["firstServerSlot"],
        message: "manual and rally first-server selection require a slot",
      });
    }
    if (
      request.firstServerSlot &&
      roster[request.firstServerSlot] === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["firstServerSlot"],
        message: "first-server slot must exist in the submitted roster",
      });
    }
    if (request.mercyEnabled === true && request.mercyPoints === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mercyPoints"],
        message: "enabled mercy cannot have a null threshold",
      });
    }
    if (request.mercyEnabled !== true && request.mercyPoints != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mercyPoints"],
        message: "disabled mercy cannot have a threshold",
      });
    }
    const registeredIds = Object.values(roster).flatMap((participant) =>
      participant?.userId ? [participant.userId] : [],
    );
    if (new Set(registeredIds).size !== registeredIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roster"],
        message: "registered participants must be distinct",
      });
    }
    const guestIdentityIds = Object.values(roster).flatMap((participant) =>
      participant?.guestIdentityId ? [participant.guestIdentityId] : [],
    );
    if (new Set(guestIdentityIds).size !== guestIdentityIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roster"],
        message: "reusable guest participants must be distinct",
      });
    }
  });

/** Canonical effective launch input; parse before fingerprinting or persistence. */
export const MatchLaunchRequestSchema = MatchLaunchRequestFieldsSchema.transform(
  (request) => {
    const pointsToWin = request.pointsToWin ?? 11;
    const mercyEnabled = request.mercyEnabled ?? false;
    return {
      ...request,
      pointsToWin,
      mercyEnabled,
      mercyPoints: mercyEnabled
        ? (request.mercyPoints ?? Math.max(1, Math.floor((pointsToWin - 1) / 2)))
        : null,
    };
  },
);
export type MatchLaunchRequest = z.infer<typeof MatchLaunchRequestSchema>;

export const MatchLaunchResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    matchId: z.string().uuid(),
  })
  .strict();
export type MatchLaunchResponse = z.infer<typeof MatchLaunchResponseSchema>;

export const MatchLaunchOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("unknown") }).strict(),
  z
    .object({
      outcome: z.literal("committed"),
      matchId: z.string().uuid(),
    })
    .strict(),
]);
export type MatchLaunchOutcome = z.infer<typeof MatchLaunchOutcomeSchema>;

export const GuestIdentitySchema = z
  .object({
    id: z.string().uuid(),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    displayName: z.string().min(1),
    avatarKey: z.string().regex(/^avatar_([1-9]|10)$/),
    version: z.number().int().min(0),
    canRename: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type GuestIdentity = z.infer<typeof GuestIdentitySchema>;

export const CreateGuestIdentityRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
  })
  .strict();
export type CreateGuestIdentityRequest = z.infer<typeof CreateGuestIdentityRequestSchema>;

export const RenameGuestIdentityRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(0),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
  })
  .strict();
export type RenameGuestIdentityRequest = z.infer<typeof RenameGuestIdentityRequestSchema>;

export const GuestIdentityMutationOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("unknown") }).strict(),
  z.object({
    outcome: z.literal("committed"),
    operation: z.enum(["create", "rename"]),
    guestId: z.string().uuid(),
    resultingVersion: z.number().int().min(0),
  }).strict(),
]);
export type GuestIdentityMutationOutcome = z.infer<typeof GuestIdentityMutationOutcomeSchema>;

export const MatchFactsSchema = z
  .object({
    initialServer: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("known"),
          participantId: z.string().uuid(),
        })
        .strict(),
      z.object({ state: z.literal("not_selected") }).strict(),
      z.object({ state: z.literal("unavailable") }).strict(),
    ]),
    playingClock: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("available"),
          elapsedMs: z.number().int().min(0),
          running: z.boolean(),
          asOf: z.string().datetime(),
        })
        .strict(),
      z.object({ state: z.literal("unavailable") }).strict(),
    ]),
    judgeHistory: z
      .object({
        state: z.enum(["complete", "partial", "unavailable"]),
        sessions: z.array(
          z
            .object({
              id: z.string().uuid(),
              userId: z.string().uuid(),
              displayName: z.string(),
              startedAt: z.string().datetime(),
              endedAt: z.string().datetime().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
export type MatchFacts = z.infer<typeof MatchFactsSchema>;

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

export const TeamAvatarKeySchema = z.custom<AvatarKey>(
  (value): value is AvatarKey =>
    typeof value === "string" &&
    isAvatarKey(value) &&
    value === `avatar_${Number(value.slice("avatar_".length))}`,
  { message: "Unknown team avatar preset" },
);

export const TeamCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slogan: z.string().trim().max(300).optional(),
    welcomeText: z.string().trim().max(2000).optional(),
    avatarKey: TeamAvatarKeySchema.nullable().optional(),
  })
  .strict();
export const TeamUpdateRequestSchema = TeamCreateRequestSchema.partial().refine(
  (value) => Object.keys(value).length > 0, { message: "At least one team field is required" },
);

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
