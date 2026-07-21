import { describe, expect, it } from "vitest";
import { avatarSrc } from "./avatarSrc";

describe("avatarSrc", () => {
  it("maps preset keys to public paths", () => {
    expect(avatarSrc("avatar_1")).toBe("/avatars/avatar_1.png");
    expect(avatarSrc("avatar_10")).toBe("/avatars/avatar_10.png");
    expect(avatarSrc(null)).toBeUndefined();
    expect(avatarSrc("nope")).toBeUndefined();
  });
});
