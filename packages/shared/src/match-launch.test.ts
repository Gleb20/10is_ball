import { describe, expect, it } from "vitest";
import {
  MatchLaunchOutcomeSchema,
  MatchLaunchRequestSchema,
  MatchLaunchResponseSchema,
} from "./index.js";

const USER_A = "00000000-0000-4000-8000-000000013001";
const USER_B = "00000000-0000-4000-8000-000000013002";
const REQUEST_ID = "00000000-0000-4000-8000-000000013101";
const GUEST_ID = "00000000-0000-4000-8000-000000040001";

function request(overrides: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST_ID,
    format: "1v1",
    mercyEnabled: true,
    pointsToWin: 12,
    firstServerMethod: "manual",
    firstServerSlot: "B1",
    roster: {
      A1: { userId: USER_A },
      B1: { userId: USER_B },
    },
    ...overrides,
  };
}

describe("GAP-013 atomic match launch contract", () => {
  it("normalizes effective launch defaults before fingerprinting", () => {
    expect(MatchLaunchRequestSchema.parse(request())).toEqual({
      requestId: REQUEST_ID,
      format: "1v1",
      pointsToWin: 12,
      mercyEnabled: true,
      mercyPoints: 5,
      firstServerMethod: "manual",
      firstServerSlot: "B1",
      roster: {
        A1: { userId: USER_A },
        B1: { userId: USER_B },
      },
    });
  });

  it("preserves an explicitly entered title but permits the server timestamp default", () => {
    expect(MatchLaunchRequestSchema.parse(request())).not.toHaveProperty("title");
    expect(MatchLaunchRequestSchema.parse(request({ title: "  Named final  " })))
      .toMatchObject({ title: "Named final" });
  });

  it("accepts exact 2v2 slots and trims inline guest identity", () => {
    expect(MatchLaunchRequestSchema.parse(request({
      format: "2v2",
      firstServerMethod: "random",
      firstServerSlot: undefined,
      mercyEnabled: false,
      roster: {
        A1: { userId: USER_A },
        A2: { guestFirstName: "  Ada ", guestLastName: " Lovelace  " },
        B1: { userId: USER_B },
        B2: { guestFirstName: "Grace", guestLastName: "Hopper" },
      },
    }))).toMatchObject({
      format: "2v2",
      mercyEnabled: false,
      mercyPoints: null,
      firstServerMethod: "random",
      roster: {
        A2: { guestFirstName: "Ada", guestLastName: "Lovelace" },
      },
    });
  });

  it("accepts a reusable guest identity and rejects duplicate identity slots", () => {
    expect(MatchLaunchRequestSchema.parse(request({
      roster: { A1: { guestIdentityId: GUEST_ID }, B1: { userId: USER_B } },
    }))).toMatchObject({ roster: { A1: { guestIdentityId: GUEST_ID } } });
    expect(MatchLaunchRequestSchema.safeParse(request({
      format: "2v2",
      roster: {
        A1: { guestIdentityId: GUEST_ID },
        A2: { guestIdentityId: GUEST_ID },
        B1: { userId: USER_A },
        B2: { userId: USER_B },
      },
    })).success).toBe(false);
  });

  it.each([
    ["1v1 with A2", request({ roster: { A1: { userId: USER_A }, A2: { guestFirstName: "A", guestLastName: "Two" }, B1: { userId: USER_B } } })],
    ["2v2 without B2", request({ format: "2v2", roster: { A1: { userId: USER_A }, A2: { guestFirstName: "A", guestLastName: "Two" }, B1: { userId: USER_B } } })],
    ["manual without slot", request({ firstServerSlot: undefined })],
    ["random with slot", request({ firstServerMethod: "random" })],
    ["slot outside roster", request({ firstServerSlot: "A2" })],
    ["identity override", request({ actorUserId: USER_A })],
    ["kind override", request({ kind: "tutorial" })],
  ])("rejects %s", (_label, value) => {
    expect(MatchLaunchRequestSchema.safeParse(value).success).toBe(false);
  });

  it("keeps POST and actor-scoped GET outcomes narrow", () => {
    expect(MatchLaunchResponseSchema.parse({
      requestId: REQUEST_ID,
      matchId: "00000000-0000-4000-8000-000000013201",
    })).toEqual({
      requestId: REQUEST_ID,
      matchId: "00000000-0000-4000-8000-000000013201",
    });
    expect(MatchLaunchOutcomeSchema.parse({ outcome: "unknown" })).toEqual({
      outcome: "unknown",
    });
    expect(MatchLaunchOutcomeSchema.parse({
      outcome: "committed",
      matchId: "00000000-0000-4000-8000-000000013201",
    })).toMatchObject({ outcome: "committed" });
  });
});
