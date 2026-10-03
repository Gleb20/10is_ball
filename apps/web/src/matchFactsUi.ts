import type { MatchFacts } from "@tab10/shared";

export type MatchFactsSnapshot = {
  facts: MatchFacts;
  matchVersion: number;
  matchStatus: string;
  receivedAtPerformanceMs: number;
  certainty: "fresh" | "checking";
};

export type PlayingClockView =
  | { state: "unavailable"; certainty: "fresh" | "checking" }
  | {
      state: "available";
      elapsedMs: number;
      running: boolean;
      certainty: "fresh" | "checking";
    };

type ParticipantLabel = { id?: string; displayName?: string };
type ProvenanceInput = {
  occurredAt?: string;
  actorUserId?: string;
  judgeSessionId?: string;
};

export type EventProvenanceView =
  | { state: "unavailable" }
  | {
      state: "known";
      occurredAt: string;
      displayName: string;
      userId: string;
      judgeSessionId: string;
    };

export const unavailableMatchFacts = (): MatchFacts => ({
  initialServer: { state: "unavailable" },
  playingClock: { state: "unavailable" },
  judgeHistory: { state: "unavailable", sessions: [] },
});

export function monotonicNow(): number {
  return typeof performance === "undefined" ? 0 : performance.now();
}

export function playingClockView(
  snapshot: MatchFactsSnapshot | null,
  atPerformanceMs: number,
): PlayingClockView {
  const clock = snapshot?.facts.playingClock;
  if (!snapshot || !clock || clock.state === "unavailable") {
    return { state: "unavailable", certainty: snapshot?.certainty ?? "fresh" };
  }
  const mayRun = snapshot.certainty === "fresh" && clock.running;
  return {
    state: "available",
    elapsedMs: Math.max(
      0,
      clock.elapsedMs + (mayRun
        ? Math.max(0, atPerformanceMs - snapshot.receivedAtPerformanceMs)
        : 0),
    ),
    running: mayRun,
    certainty: snapshot.certainty,
  };
}

export function acceptMatchFacts(
  previous: MatchFactsSnapshot | null,
  facts: MatchFacts | undefined,
  matchVersion: number,
  matchStatus: string,
  receivedAtPerformanceMs = monotonicNow(),
): MatchFactsSnapshot {
  const nextFacts = facts ?? unavailableMatchFacts();
  if (
    previous?.matchVersion === matchVersion &&
    previous.facts.playingClock.state === "available" &&
    nextFacts.playingClock.state === "available" &&
    nextFacts.playingClock.running
  ) {
    const previousElapsed = playingClockView(previous, receivedAtPerformanceMs);
    if (
      previousElapsed.state === "available" &&
      previousElapsed.elapsedMs > nextFacts.playingClock.elapsedMs
    ) {
      return {
        facts: {
          ...nextFacts,
          playingClock: {
            ...nextFacts.playingClock,
            elapsedMs: previousElapsed.elapsedMs,
          },
        },
        matchVersion,
        matchStatus,
        receivedAtPerformanceMs,
        certainty: "fresh",
      };
    }
  }
  return {
    facts: nextFacts,
    matchVersion,
    matchStatus,
    receivedAtPerformanceMs,
    certainty: "fresh",
  };
}

export function freezeMatchFacts(
  snapshot: MatchFactsSnapshot | null,
  atPerformanceMs = monotonicNow(),
): MatchFactsSnapshot | null {
  if (!snapshot || snapshot.certainty === "checking") return snapshot;
  const clock = playingClockView(snapshot, atPerformanceMs);
  return {
    ...snapshot,
    facts: clock.state === "available"
      ? {
          ...snapshot.facts,
          playingClock: {
            state: "available",
            elapsedMs: clock.elapsedMs,
            running: false,
            asOf: snapshot.facts.playingClock.state === "available"
              ? snapshot.facts.playingClock.asOf
              : new Date(0).toISOString(),
          },
        }
      : snapshot.facts,
    receivedAtPerformanceMs: atPerformanceMs,
    certainty: "checking",
  };
}

export function firstServerLabel(
  initialServer: MatchFacts["initialServer"],
  participants: ParticipantLabel[],
): string {
  if (initialServer.state === "not_selected") return "Ещё не выбран";
  if (initialServer.state === "unavailable") return "Недоступно";
  return participants.find((participant) => participant.id === initialServer.participantId)
    ?.displayName ?? "Участник недоступен";
}

export function eventProvenance(
  event: ProvenanceInput,
  snapshot: MatchFactsSnapshot | null,
): EventProvenanceView {
  if (!event.occurredAt || !event.actorUserId || !event.judgeSessionId || !snapshot) {
    return { state: "unavailable" };
  }
  const session = snapshot.facts.judgeHistory.sessions.find(
    (candidate) => candidate.id === event.judgeSessionId &&
      candidate.userId === event.actorUserId,
  );
  if (!session) return { state: "unavailable" };
  return {
    state: "known",
    occurredAt: event.occurredAt,
    displayName: session.displayName,
    userId: session.userId,
    judgeSessionId: session.id,
  };
}

export function formatFactDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Время недоступно";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
