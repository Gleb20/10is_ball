import { describe, expect, it } from "vitest";
import {
  generateSingleEliminationBracket,
  type Bracket,
} from "@tab10/shared";
import {
  buildBracketViewModel,
  challongeRoundLabel,
} from "./bracketViewModel";

describe("challongeRoundLabel", () => {
  it("labels SE rounds like Challonge", () => {
    expect(challongeRoundLabel(8, 0, "main")).toBe("1/4");
    expect(challongeRoundLabel(8, 1, "main")).toBe("1/2");
    expect(challongeRoundLabel(8, 2, "main")).toBe("Финал");
    expect(challongeRoundLabel(4, 0, "final")).toBe("Гранд-финал");
  });
});

describe("buildBracketViewModel", () => {
  it("builds named cards for 4-player SE with judge CTA and bands", () => {
    const ids = ["p1", "p2", "p3", "p4"];
    const bracket = generateSingleEliminationBracket(ids, () =>
      crypto.randomUUID(),
    ) as Bracket;
    const r0 = bracket.slots.filter(
      (s) => s.round === 0 && s.side === "main",
    );
    expect(r0.length).toBeGreaterThanOrEqual(2);
    const matchId = "m-r0-0";
    r0[0]!.matchId = matchId;
    r0[1]!.matchId = matchId;
    r0[0]!.participantId = "p1";
    r0[1]!.participantId = "p2";

    const names = new Map([
      ["p1", "Альфа А"],
      ["p2", "Бета Б"],
      ["p3", "Гамма Г"],
      ["p4", "Дельта Д"],
    ]);
    const vm = buildBracketViewModel(bracket, names, [
      { id: matchId, status: "waiting", scoreA: 0, scoreB: 0 },
    ], {
      avatars: { p1: "avatar_1", p2: "avatar_2" },
      seeds: { p1: 1, p2: 2 },
    });

    expect(vm.bands.some((b) => b.id === "winners")).toBe(true);
    const named = vm.bands
      .flatMap((b) => b.columns)
      .flatMap((c) => c.cards)
      .find((c) => c.matchId === matchId);
    expect(named).toBeTruthy();
    expect(named!.slotA.displayName).toBe("Альфа А");
    expect(named!.slotA.avatarKey).toBe("avatar_1");
    expect(named!.slotA.seed).toBe(1);
    expect(named!.cta).toBe("judge");
  });

  it("BYE card shows auto-advance name", () => {
    const bracket = generateSingleEliminationBracket(
      ["p1", "p2", "p3"],
      () => crypto.randomUUID(),
    );
    const names = new Map([
      ["p1", "Иван"],
      ["p2", "Пётр"],
      ["p3", "Сидор"],
    ]);
    const vm = buildBracketViewModel(bracket, names, []);
    const byeCard = vm.bands
      .flatMap((b) => b.columns)
      .flatMap((c) => c.cards)
      .find((c) => c.cta === "bye");
    expect(byeCard).toBeTruthy();
    expect(byeCard!.autoAdvanceName).toBeTruthy();
  });
});
