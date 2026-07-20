export type JudgeParticipant = {
  id: string;
  side: "A" | "B" | string;
  userId?: string | null;
  guestFirstName?: string | null;
  guestLastName?: string | null;
  isTutorialActor?: boolean | null;
};

export type JudgeMatchLike = {
  currentServerParticipantId?: string | null;
  participants?: JudgeParticipant[];
};

export function participantDisplayName(p: JudgeParticipant): string {
  if (p.isTutorialActor) return "Призрачный Олег";
  const first = (p.guestFirstName ?? "").trim();
  const last = (p.guestLastName ?? "").trim();
  const guest = [first, last].filter(Boolean).join(" ");
  if (guest) return guest;
  return p.side === "A" ? "Сторона A" : p.side === "B" ? "Сторона B" : "Игрок";
}

export function sideDisplayName(
  match: JudgeMatchLike,
  side: "A" | "B",
): string {
  const list = (match.participants ?? []).filter((p) => p.side === side);
  if (list.length === 0) return side === "A" ? "Сторона A" : "Сторона B";
  return list.map(participantDisplayName).join(" / ");
}

/** Which court side currently serves, or null if unknown. */
export function servingSide(match: JudgeMatchLike): "A" | "B" | null {
  const serverId = match.currentServerParticipantId;
  if (!serverId) return null;
  const p = (match.participants ?? []).find((x) => x.id === serverId);
  if (!p) return null;
  return p.side === "A" || p.side === "B" ? p.side : null;
}

/**
 * Show rotate-to-landscape hint on narrow portrait phones.
 * Desktop / already landscape → false.
 */
export function shouldShowLandscapeHint(
  width: number,
  height: number,
): boolean {
  return width < 900 && height > width;
}
