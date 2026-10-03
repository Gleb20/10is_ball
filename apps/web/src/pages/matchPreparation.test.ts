import { describe, expect, it } from "vitest";
import {
  buildMatchLaunchRequest,
  createReplaySeed,
  defaultMercyPoints,
  holdPreparationForGuestCatalogue,
  readReplaySeed,
  takePreparationFromGuestCatalogue,
  type PreparationSlot,
} from "./matchPreparation";

const userSlot = (userId: string, userLabel = userId): PreparationSlot => ({
  mode: "user",
  userId,
  userLabel,
  guestName: "",
});

describe("GAP-013 match preparation contract", () => {
  it("uses the accepted D38 mercy formula for the current form only", () => {
    expect(defaultMercyPoints(1)).toBe(1);
    expect(defaultMercyPoints(11)).toBe(5);
    expect(defaultMercyPoints(12)).toBe(5);
    expect(defaultMercyPoints(21)).toBe(10);
  });

  it("builds exact canonical 2x2 slots after a client-side table swap", () => {
    const payload = buildMatchLaunchRequest({
      requestId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Парный матч",
      format: "2v2",
      pointsToWin: 12,
      mercyEnabled: true,
      mercyPoints: 5,
      firstServerMethod: "manual",
      firstServerSlot: "A2",
      creatorParticipates: false,
      sidesSwapped: true,
      slots: {
        playerA: userSlot("11111111-aaaa-4aaa-8aaa-111111111111"),
        partner: userSlot("22222222-aaaa-4aaa-8aaa-222222222222"),
        opponent1: userSlot("33333333-aaaa-4aaa-8aaa-333333333333"),
        opponent2: {
          mode: "guest",
          userId: "",
          userLabel: "",
          guestName: "Гость Четыре",
        },
      },
    });

    expect(payload).toEqual({
      requestId: "11111111-1111-4111-8111-111111111111",
      title: "Парный матч",
      format: "2v2",
      pointsToWin: 12,
      mercyEnabled: true,
      mercyPoints: 5,
      firstServerMethod: "manual",
      firstServerSlot: "A2",
      roster: {
        A1: { userId: "33333333-aaaa-4aaa-8aaa-333333333333" },
        A2: { guestFirstName: "Гость", guestLastName: "Четыре" },
        B1: { userId: "11111111-aaaa-4aaa-8aaa-111111111111" },
        B2: { userId: "22222222-aaaa-4aaa-8aaa-222222222222" },
      },
    });
  });

  it("copies only ordinary finished/stopped matches and binds the seed to its actor", () => {
    const seed = createReplaySeed({
      kind: "standalone",
      status: "finished",
      title: "Финал вечера",
      format: "1v1",
      pointsToWin: 11,
      mercyEnabled: true,
      mercyPoints: 5,
      firstServerMethod: "rally",
      participants: [
        { side: "A", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Анна Первая" },
        { side: "B", guestFirstName: "Борис", guestLastName: "Второй", displayName: "Борис Второй" },
      ],
    }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(seed).toMatchObject({
      actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Финал вечера",
      creatorParticipates: true,
      slots: { opponent1: { mode: "guest", guestName: "Борис Второй" } },
    });
    expect(readReplaySeed({ matchReplaySeed: seed }, seed!.actorId)).toEqual(seed);
    expect(readReplaySeed({ matchReplaySeed: seed }, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBeNull();
    expect(createReplaySeed({ kind: "tournament", status: "finished" }, seed!.actorId)).toBeNull();
    expect(createReplaySeed({ kind: "standalone", status: "cancelled" }, seed!.actorId)).toBeNull();
  });

  it("launches a selected reusable guest by id without inferring identity from its name", () => {
    const payload = buildMatchLaunchRequest({
      requestId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Матч с гостем",
      format: "1v1",
      pointsToWin: 11,
      mercyEnabled: false,
      mercyPoints: 5,
      firstServerMethod: "random",
      creatorParticipates: true,
      sidesSwapped: false,
      slots: {
        playerA: userSlot("unused"),
        partner: userSlot("unused"),
        opponent1: {
          mode: "guest",
          userId: "",
          userLabel: "",
          guestName: "Одинаковое Имя",
          guestIdentityId: "22222222-2222-4222-8222-222222222222",
          guestIdentityLabel: "Одинаковое Имя",
          guestAvatarKey: "avatar_3",
        },
        opponent2: userSlot("unused"),
      },
    });

    expect(payload.roster.B1).toEqual({
      guestIdentityId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("replays a reusable guest as the same identity without changing the caller", () => {
    const seed = createReplaySeed({
      kind: "standalone",
      status: "stopped",
      format: "1v1",
      participants: [
        { side: "A", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Анна" },
        {
          side: "B",
          guestIdentityId: "22222222-2222-4222-8222-222222222222",
          displayName: "Гость Два",
          avatarKey: "avatar_2",
        },
      ],
    }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(seed?.slots.opponent1).toMatchObject({
      mode: "guest",
      guestIdentityId: "22222222-2222-4222-8222-222222222222",
      guestIdentityLabel: "Гость Два",
      guestAvatarKey: "avatar_2",
    });
  });

  it("keeps one actor-bound in-memory draft token and consumes it once", () => {
    const seed = createReplaySeed({
      kind: "standalone",
      status: "finished",
      format: "1v1",
      participants: [
        { side: "A", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        { side: "B", guestFirstName: "Гость", guestLastName: "Один" },
      ],
    }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!;

    const token = holdPreparationForGuestCatalogue(seed);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(takePreparationFromGuestCatalogue(token, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBeNull();
    expect(takePreparationFromGuestCatalogue(token, seed.actorId)).toBeNull();

    const nextToken = holdPreparationForGuestCatalogue(seed);
    expect(takePreparationFromGuestCatalogue(nextToken, seed.actorId)).toEqual(seed);
    expect(takePreparationFromGuestCatalogue(nextToken, seed.actorId)).toBeNull();
  });
});
