import { describe, expect, it } from "vitest";
import {
  TeamCreateRequestSchema,
  TeamUpdateRequestSchema,
} from "./index.js";

describe("team avatar request contracts", () => {
  it("accepts a preset on create and explicit null on update", () => {
    expect(
      TeamCreateRequestSchema.parse({ name: "Ракетки", avatarKey: "avatar_10" }),
    ).toEqual({ name: "Ракетки", avatarKey: "avatar_10" });
    expect(TeamUpdateRequestSchema.parse({ avatarKey: null })).toEqual({
      avatarKey: null,
    });
  });

  it("keeps omission distinct from clearing the avatar", () => {
    const update = TeamUpdateRequestSchema.parse({ slogan: "Играем вместе" });
    expect(update).not.toHaveProperty("avatarKey");
  });

  it.each([
    "avatar_0",
    "avatar_11",
    "avatar_01",
    "/avatars/avatar_1.png",
    "https://example.com/avatar.png",
    "upload.png",
  ])("rejects unsupported avatar value %s", (avatarKey) => {
    expect(() =>
      TeamCreateRequestSchema.parse({ name: "Ракетки", avatarKey }),
    ).toThrow();
  });

  it("rejects upload and URL-shaped extension fields", () => {
    expect(() =>
      TeamCreateRequestSchema.parse({
        name: "Ракетки",
        avatarUrl: "https://example.com/avatar.png",
      }),
    ).toThrow();
    expect(() =>
      TeamUpdateRequestSchema.parse({ avatarUpload: "data:image/png;base64,AA==" }),
    ).toThrow();
  });
});
