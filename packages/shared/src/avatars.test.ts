import { describe, expect, it } from "vitest";
import {
  AVATAR_PRESET_COUNT,
  avatarPublicPath,
  isAvatarKey,
  randomAvatarKey,
} from "./avatars.js";

describe("avatar presets", () => {
  it("randomAvatarKey stays in 1..10", () => {
    for (let b = 0; b < 256; b += 1) {
      const key = randomAvatarKey(b);
      expect(isAvatarKey(key)).toBe(true);
      const n = Number(key.split("_")[1]);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(AVATAR_PRESET_COUNT);
    }
  });

  it("avatarPublicPath maps keys", () => {
    expect(avatarPublicPath("avatar_3")).toBe("/avatars/avatar_3.png");
    expect(avatarPublicPath("avatar_99")).toBeNull();
    expect(avatarPublicPath(null)).toBeNull();
  });
});
