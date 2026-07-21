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
]);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

export const MatchKindSchema = z.enum(["standalone", "tournament", "tutorial"]);
export type MatchKind = z.infer<typeof MatchKindSchema>;

export const SideSchema = z.enum(["A", "B"]);
export type Side = z.infer<typeof SideSchema>;

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
