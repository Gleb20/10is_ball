export type JudgeParticipant = {
  id: string;
  side: "A" | "B" | string;
  userId?: string | null;
  guestFirstName?: string | null;
  guestLastName?: string | null;
  isTutorialActor?: boolean | null;
  displayName?: string | null;
};

export type ActiveJudge = {
  userId: string;
  displayName: string;
};

export type JudgeMatchLike = {
  currentServerParticipantId?: string | null;
  participants?: JudgeParticipant[];
  scoreA?: number;
  scoreB?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  status?: string;
  judgeDisplayFlipped?: boolean;
  activeJudge?: ActiveJudge | null;
};

export function participantDisplayName(p: JudgeParticipant): string {
  if (p.displayName?.trim()) return p.displayName.trim();
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

export function needsJudgeSetup(match: JudgeMatchLike): boolean {
  const total = Number(match.scoreA ?? 0) + Number(match.scoreB ?? 0);
  return total === 0;
}

export function elapsedMs(
  startedAt: string | null | undefined,
  now: Date,
  finishedAt?: string | null,
  status?: string,
): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  if (finishedAt) {
    const end = new Date(finishedAt).getTime();
    if (!Number.isNaN(end)) return Math.max(0, end - start);
  }
  if (status === "pending_confirmation") {
    return Math.max(0, now.getTime() - start);
  }
  return Math.max(0, now.getTime() - start);
}

export function formatMatchDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function judgeAcquireErrorMessage(error: {
  message?: string;
  code?: string;
  details?: { currentJudge?: { userId?: string; displayName?: string } };
}): string {
  const name = error.details?.currentJudge?.displayName;
  if (error.code === "JUDGE_TAKEN" && name) {
    return `Этот матч уже судит «${name}», два судьи у матча — дело к драке. Давай не будем.`;
  }
  if (error.code === "JUDGE_BUSY") {
    return "Вы уже судите другой матч. Освободите слот и попробуйте снова.";
  }
  if (error.code === "JUDGE_OTHER_DEVICE") {
    return "Судейство уже открыто на другом устройстве.";
  }
  return error.message ?? "Не удалось подключиться как судья";
}

export function boardSides(
  match: JudgeMatchLike,
): { left: "A" | "B"; right: "A" | "B" } {
  if (match.judgeDisplayFlipped) {
    return { left: "B", right: "A" };
  }
  return { left: "A", right: "B" };
}
