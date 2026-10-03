import { describe, expect, it } from "vitest";
import {
  CreateGuestIdentityRequestSchema,
  GuestIdentityMutationOutcomeSchema,
  GuestIdentitySchema,
  RenameGuestIdentityRequestSchema,
} from "./index.js";

const ID = "00000000-0000-4000-8000-000000040001";

describe("D40 reusable guest contract", () => {
  it("trims mutation names and requires version fencing for rename", () => {
    expect(CreateGuestIdentityRequestSchema.parse({
      requestId: ID,
      firstName: " Ada ",
      lastName: " Lovelace ",
    })).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
    expect(RenameGuestIdentityRequestSchema.safeParse({
      requestId: ID,
      firstName: "Ada",
      lastName: "Byron",
    }).success).toBe(false);
  });

  it("keeps DTO and actor-bound receipt outcomes narrow", () => {
    expect(GuestIdentitySchema.parse({
      id: ID,
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Lovelace Ada",
      avatarKey: "avatar_10",
      version: 0,
      canRename: true,
      createdAt: "2026-10-03T12:00:00.000Z",
      updatedAt: "2026-10-03T12:00:00.000Z",
    })).toMatchObject({ id: ID, version: 0 });
    expect(GuestIdentityMutationOutcomeSchema.parse({ outcome: "unknown" }))
      .toEqual({ outcome: "unknown" });
  });
});
