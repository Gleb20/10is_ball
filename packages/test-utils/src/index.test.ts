import { describe, expect, it } from "vitest";
import {
  FakeClock,
  percentile,
  SeededRng,
  SequentialIdGenerator,
} from "./index.js";

describe("REQ_shared__deterministic_clock", () => {
  it("returns fixed time and advances deterministically", () => {
    const clock = new FakeClock(new Date("2026-07-01T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-07-01T00:00:00.000Z");
    clock.advanceMs(60_000);
    expect(clock.now().toISOString()).toBe("2026-07-01T00:01:00.000Z");
  });
});

describe("REQ_shared__seeded_rng", () => {
  it("produces reproducible sequences", () => {
    const a = new SeededRng(7);
    const b = new SeededRng(7);
    expect([a.next(), a.next(), a.int(1, 10)]).toEqual([
      b.next(),
      b.next(),
      b.int(1, 10),
    ]);
  });
});

describe("REQ_shared__percentile", () => {
  it("computes nearest-rank p95", () => {
    expect(percentile([100, 200, 300, 400, 500], 95)).toBe(500);
    expect(percentile([], 95)).toBe(0);
  });
});

describe("REQ_shared__sequential_ids", () => {
  it("emits unique sequential ids", () => {
    const ids = new SequentialIdGenerator("u");
    expect(ids.next()).toBe("u_00000001");
    expect(ids.next()).toBe("u_00000002");
  });
});
