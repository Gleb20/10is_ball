import { avatarPublicPath } from "@tab10/shared";

/** Resolve preset avatar URL for img/Avatar src. */
export function avatarSrc(
  key: string | null | undefined,
): string | undefined {
  return avatarPublicPath(key) ?? undefined;
}
