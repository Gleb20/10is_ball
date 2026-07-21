/**
 * Meme avatar presets (stable keys avatar_1 … avatar_10).
 * Assigned once on user/guest create; never regenerated in MVP.
 */
export const AVATAR_PRESET_COUNT = 10;

export type AvatarKey = `avatar_${number}`;

export function isAvatarKey(value: string | null | undefined): value is AvatarKey {
  if (!value) return false;
  const m = /^avatar_(\d+)$/.exec(value);
  if (!m) return false;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= AVATAR_PRESET_COUNT;
}

/** Pick a stable random preset key using a byte 0–255 (or any uint). */
export function randomAvatarKey(randomByte: number): AvatarKey {
  const n = (Math.abs(randomByte) % AVATAR_PRESET_COUNT) + 1;
  return `avatar_${n}`;
}

/** Public URL path for a preset (served from web /public/avatars). */
export function avatarPublicPath(key: string | null | undefined): string | null {
  if (!isAvatarKey(key)) return null;
  return `/avatars/${key}.png`;
}
