import {
  MatchLaunchRequestSchema,
  type MatchLaunchRequest,
  type MatchLaunchSlot,
} from "@tab10/shared";

export type MatchFormat = "1v1" | "2v2";
export type FirstServerMethod = "random" | "manual" | "rally";
export type PreparationSlotKey = "playerA" | "partner" | "opponent1" | "opponent2";
export type PreparationSlot = {
  mode: "user" | "guest";
  userId: string;
  userLabel: string;
  guestName: string;
  guestIdentityId?: string;
  guestIdentityLabel?: string;
  guestAvatarKey?: string;
};
export type PreparationSlots = Record<PreparationSlotKey, PreparationSlot>;

export type MatchPreparationSeed = {
  actorId: string;
  title: string;
  format: MatchFormat;
  pointsToWin: number;
  mercyEnabled: boolean;
  mercyPoints: number;
  firstServerMethod: FirstServerMethod;
  creatorParticipates: boolean;
  slots: PreparationSlots;
  draftValues?: {
    pointsChoice: "11" | "21" | "custom";
    pointsToWin: string;
    customPointsToWin: string;
    mercyPoints: string;
    mercyManuallyEdited: boolean;
  };
};

type ReplayParticipant = {
  side?: unknown;
  userId?: unknown;
  guestIdentityId?: unknown;
  guestFirstName?: unknown;
  guestLastName?: unknown;
  displayName?: unknown;
  avatarKey?: unknown;
};

type ReplayMatch = {
  kind?: unknown;
  status?: unknown;
  title?: unknown;
  format?: unknown;
  pointsToWin?: unknown;
  mercyEnabled?: unknown;
  mercyPoints?: unknown;
  firstServerMethod?: unknown;
  participants?: unknown;
};

export const emptyPreparationSlot = (): PreparationSlot => ({
  mode: "user",
  userId: "",
  userLabel: "",
  guestName: "",
});

export const emptyPreparationSlots = (): PreparationSlots => ({
  playerA: emptyPreparationSlot(),
  partner: emptyPreparationSlot(),
  opponent1: emptyPreparationSlot(),
  opponent2: emptyPreparationSlot(),
});

export function defaultMercyPoints(pointsToWin: number): number {
  return Math.max(1, Math.floor((pointsToWin - 1) / 2));
}

function participantFromSlot(slot: PreparationSlot) {
  if (slot.mode === "user") {
    if (!slot.userId) throw new Error("Выберите всех игроков из списка");
    return { userId: slot.userId };
  }
  if (slot.guestIdentityId) {
    return { guestIdentityId: slot.guestIdentityId };
  }
  const parts = slot.guestName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) throw new Error("Для гостя укажите имя и фамилию");
  return {
    guestFirstName: parts[0]!,
    guestLastName: parts.slice(1).join(" "),
  };
}

export function buildMatchLaunchRequest(input: {
  requestId: string;
  actorUserId: string;
  title: string;
  format: MatchFormat;
  pointsToWin: number;
  mercyEnabled: boolean;
  mercyPoints: number;
  firstServerMethod: FirstServerMethod;
  firstServerSlot?: MatchLaunchSlot;
  creatorParticipates: boolean;
  sidesSwapped: boolean;
  slots: PreparationSlots;
}): MatchLaunchRequest {
  const sideA = [
    input.creatorParticipates
      ? { userId: input.actorUserId }
      : participantFromSlot(input.slots.playerA),
    ...(input.format === "2v2" ? [participantFromSlot(input.slots.partner)] : []),
  ];
  const sideB = [
    participantFromSlot(input.slots.opponent1),
    ...(input.format === "2v2" ? [participantFromSlot(input.slots.opponent2)] : []),
  ];
  const [logicalA, logicalB] = input.sidesSwapped ? [sideB, sideA] : [sideA, sideB];
  const roster = {
    A1: logicalA[0]!,
    ...(input.format === "2v2" ? { A2: logicalA[1]! } : {}),
    B1: logicalB[0]!,
    ...(input.format === "2v2" ? { B2: logicalB[1]! } : {}),
  };

  return MatchLaunchRequestSchema.parse({
    requestId: input.requestId,
    title: input.title.trim(),
    format: input.format,
    pointsToWin: input.pointsToWin,
    mercyEnabled: input.mercyEnabled,
    mercyPoints: input.mercyEnabled ? input.mercyPoints : null,
    firstServerMethod: input.firstServerMethod,
    ...(input.firstServerMethod === "random"
      ? {}
      : { firstServerSlot: input.firstServerSlot }),
    roster,
  });
}

function replaySlot(participant?: ReplayParticipant): PreparationSlot {
  if (!participant) return emptyPreparationSlot();
  if (typeof participant.userId === "string" && participant.userId) {
    return {
      mode: "user",
      userId: participant.userId,
      userLabel: typeof participant.displayName === "string" ? participant.displayName : "",
      guestName: "",
    };
  }
  if (typeof participant.guestIdentityId === "string" && participant.guestIdentityId) {
    return {
      mode: "guest",
      userId: "",
      userLabel: "",
      guestName: "",
      guestIdentityId: participant.guestIdentityId,
      guestIdentityLabel:
        typeof participant.displayName === "string" ? participant.displayName : "",
      guestAvatarKey:
        typeof participant.avatarKey === "string" ? participant.avatarKey : undefined,
    };
  }
  const first = typeof participant.guestFirstName === "string" ? participant.guestFirstName : "";
  const last = typeof participant.guestLastName === "string" ? participant.guestLastName : "";
  return {
    mode: "guest",
    userId: "",
    userLabel: "",
    guestName: [first, last].filter(Boolean).join(" "),
  };
}

export function createReplaySeed(match: ReplayMatch, actorId: string): MatchPreparationSeed | null {
  if (
    match.kind !== "standalone" ||
    (match.status !== "finished" && match.status !== "stopped") ||
    !Array.isArray(match.participants)
  ) return null;

  const participants = match.participants as ReplayParticipant[];
  const sideA = participants.filter((participant) => participant.side === "A");
  const sideB = participants.filter((participant) => participant.side === "B");
  const format: MatchFormat = match.format === "2v2" ? "2v2" : "1v1";
  if (!sideA[0] || !sideB[0] || (format === "2v2" && (!sideA[1] || !sideB[1]))) return null;
  const creatorParticipates = sideA[0]?.userId === actorId;
  const pointsToWin =
    typeof match.pointsToWin === "number" && Number.isInteger(match.pointsToWin) && match.pointsToWin > 0
      ? match.pointsToWin
      : 11;
  const mercyEnabled = match.mercyEnabled === true;
  const mercyPoints =
    typeof match.mercyPoints === "number" && Number.isInteger(match.mercyPoints) && match.mercyPoints > 0
      ? match.mercyPoints
      : defaultMercyPoints(pointsToWin);
  const firstServerMethod: FirstServerMethod =
    match.firstServerMethod === "random" ||
    match.firstServerMethod === "rally" ||
    match.firstServerMethod === "manual"
      ? match.firstServerMethod
      : "manual";

  return {
    actorId,
    title: typeof match.title === "string" ? match.title : "",
    format,
    pointsToWin,
    mercyEnabled,
    mercyPoints,
    firstServerMethod,
    creatorParticipates,
    slots: {
      playerA: creatorParticipates ? emptyPreparationSlot() : replaySlot(sideA[0]),
      partner: replaySlot(sideA[1]),
      opponent1: replaySlot(sideB[0]),
      opponent2: replaySlot(sideB[1]),
    },
  };
}

function isPreparationSlot(value: unknown): value is PreparationSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<PreparationSlot>;
  return (slot.mode === "user" || slot.mode === "guest") &&
    typeof slot.userId === "string" &&
    typeof slot.userLabel === "string" &&
    typeof slot.guestName === "string" &&
    (slot.guestIdentityId === undefined || typeof slot.guestIdentityId === "string") &&
    (slot.guestIdentityLabel === undefined || typeof slot.guestIdentityLabel === "string") &&
    (slot.guestAvatarKey === undefined || typeof slot.guestAvatarKey === "string");
}

export function readReplaySeed(state: unknown, actorId?: string): MatchPreparationSeed | null {
  if (!actorId || !state || typeof state !== "object") return null;
  const seed = (state as { matchReplaySeed?: unknown }).matchReplaySeed;
  if (!seed || typeof seed !== "object") return null;
  const value = seed as Partial<MatchPreparationSeed>;
  if (
    value.actorId !== actorId ||
    typeof value.title !== "string" ||
    (value.format !== "1v1" && value.format !== "2v2") ||
    typeof value.pointsToWin !== "number" ||
    typeof value.mercyEnabled !== "boolean" ||
    typeof value.mercyPoints !== "number" ||
    (value.firstServerMethod !== "random" && value.firstServerMethod !== "manual" && value.firstServerMethod !== "rally") ||
    typeof value.creatorParticipates !== "boolean" ||
    !value.slots ||
    !Object.values(value.slots).every(isPreparationSlot)
  ) return null;
  return value as MatchPreparationSeed;
}

let preparationDetour: { token: string; seed: MatchPreparationSeed } | null = null;

/**
 * One-tab, one-attempt bridge for the optional guest catalogue detour.
 * It deliberately never touches browser storage and is consumed on the first read.
 */
export function holdPreparationForGuestCatalogue(seed: MatchPreparationSeed, requestedToken?: string): string {
  const token = requestedToken ?? crypto.randomUUID();
  preparationDetour = { token, seed };
  return token;
}

export function takePreparationFromGuestCatalogue(
  token: string,
  actorId: string,
): MatchPreparationSeed | null {
  const held = preparationDetour;
  preparationDetour = null;
  if (!held || held.token !== token || held.seed.actorId !== actorId) return null;
  return held.seed;
}
