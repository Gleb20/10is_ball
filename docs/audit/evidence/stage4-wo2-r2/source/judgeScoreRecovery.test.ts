import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptReviewedPointScore,
  appendPointIntent,
  beginPointAttempt,
  beginScoreRecoveryGeneration,
  createScoreRecoveryRecord,
  discardUnsentPointIntents,
  isScoreRecoveryGenerationCurrent,
  markPointAttemptError,
  markPointAttemptApplied,
  markPointAttemptNoWrite,
  persistScoreRecoveryRecord,
  readScoreRecoveryRecord,
  reconcilePointAttempts,
  rememberScoreRecoveryRecord,
  resetScoreRecoveryForTests,
  restoreSendingAttemptsAsUnknown,
  scoreRecoveryStorageKey,
} from "./judgeScoreRecovery";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  getItem(key: string) {
    if (this.failReads) throw new Error("storage read failed");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("storage write failed");
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("judge score recovery store", () => {
  beforeEach(() => resetScoreRecoveryForTests());

  it("uses a fresh mount generation and never restores a persisted request epoch", () => {
    const first = beginScoreRecoveryGeneration("u1", "m1");
    const second = beginScoreRecoveryGeneration("u1", "m1");

    expect(isScoreRecoveryGenerationCurrent("u1", "m1", first)).toBe(false);
    expect(isScoreRecoveryGenerationCurrent("u1", "m1", second)).toBe(true);
  });

  it("restores sending as unknown and preserves ordered rapid intentions", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = appendPointIntent(record, { id: "b", side: "B", idempotencyKey: "key-b" });
    record = appendPointIntent(record, { id: "c", side: "A", idempotencyKey: "key-c" });

    const restored = restoreSendingAttemptsAsUnknown(record);

    expect(restored.attempts).toEqual([
      expect.objectContaining({ id: "a", state: "unknown", expectedVersion: 5 }),
    ]);
    expect(restored.unsent.map(({ id, side }) => ({ id, side }))).toEqual([
      { id: "b", side: "B" },
      { id: "c", side: "A" },
    ]);
    expect(restored.pausedAfterError).toBe(true);
  });

  it("invalidates a cached read decision and accepted no-key choice on every remount", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    record = acceptReviewedPointScore(reconcilePointAttempts(record, 5, []).record);
    expect(record.readState).toBe("no-key");
    expect(record.attempts[0]?.state).toBe("accepted-no-key");

    const restored = restoreSendingAttemptsAsUnknown(record);

    expect(restored.readState).toBe("idle");
    expect(restored.reviewedVersion).toBeUndefined();
    expect(restored.attempts).toEqual([
      expect.objectContaining({ id: "a", state: "unknown" }),
    ]);
    expect(restored.attempts[0]?.reviewedVersion).toBeUndefined();
  });

  it("keeps a failed durable write in SPA memory without sending or dropping the intent", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const record = appendPointIntent(
      createScoreRecoveryRecord("u1", "m1", 5),
      { id: "b", side: "B", idempotencyKey: "key-b" },
    );

    const saved = persistScoreRecoveryRecord(record, storage);
    const restored = readScoreRecoveryRecord("u1", "m1", storage);

    expect(saved.ok).toBe(false);
    expect(saved.record.storageSafe).toBe(false);
    expect(saved.record.pausedAfterError).toBe(true);
    expect(restored).toMatchObject({
      storageError: null,
      record: { storageSafe: false, unsent: [{ id: "b", side: "B", idempotencyKey: "key-b" }] },
    });
  });

  it("resolves only exact known keys and retains multiple other unknown attempts", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    record = acceptReviewedPointScore(reconcilePointAttempts(record, 5, []).record);
    record = appendPointIntent(record, { id: "b", side: "B", idempotencyKey: "key-b" });
    record = beginPointAttempt(record, 5, true).record;
    record = markPointAttemptError(record, "b");

    const reconciled = reconcilePointAttempts(record, 6, ["key-a", "unfamiliar-key"]);

    expect(reconciled.record.attempts).toEqual([
      expect.objectContaining({ id: "b", idempotencyKey: "key-b", state: "unknown" }),
    ]);
    expect(reconciled.appliedAttemptIds).toEqual(["a"]);
    expect(reconciled.record.readState).toBe("no-key");
  });

  it("known no-write resolves only its attempt and keeps unrelated work paused", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = appendPointIntent(record, { id: "b", side: "B", idempotencyKey: "key-b" });

    const resolved = markPointAttemptNoWrite(record, "a");

    expect(resolved.attempts).toEqual([]);
    expect(resolved.unsent.map((intent) => intent.id)).toEqual(["b"]);
    expect(resolved.pausedAfterError).toBe(true);
  });

  it("uses a fence version conflict to resolve only eligible accepted attempts", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    record = acceptReviewedPointScore(reconcilePointAttempts(record, 5, []).record);
    record = {
      ...record,
      attempts: [
        ...record.attempts,
        {
          id: "later-a",
          side: "A",
          idempotencyKey: "key-later-a",
          expectedVersion: 6,
          state: "accepted-no-key",
          reviewedVersion: 6,
        },
      ],
      pausedAfterError: false,
      unsent: [
        { id: "fence", side: "A", idempotencyKey: "key-fence" },
        { id: "b", side: "B", idempotencyKey: "key-b" },
      ],
    };
    record = beginPointAttempt(record, 5, true).record;

    const resolved = markPointAttemptNoWrite(record, "fence", true);

    expect(resolved.attempts).toEqual([
      expect.objectContaining({ id: "later-a", expectedVersion: 6 }),
    ]);
    expect(resolved.unsent).toEqual([{ id: "b", side: "B", idempotencyKey: "key-b" }]);
    expect(resolved.pausedAfterError).toBe(true);
  });

  it("does not use a validation failure as proof for older accepted attempts", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    record = acceptReviewedPointScore(reconcilePointAttempts(record, 5, []).record);
    record = {
      ...record,
      pausedAfterError: false,
      unsent: [{ id: "fence", side: "A", idempotencyKey: "key-fence" }],
    };
    record = beginPointAttempt(record, 5, true).record;

    const resolved = markPointAttemptNoWrite(record, "fence", false);

    expect(resolved.attempts).toEqual([
      expect.objectContaining({ id: "a", state: "accepted-no-key", expectedVersion: 5 }),
    ]);
    expect(resolved.pausedAfterError).toBe(true);
  });

  it("uses a successful reviewed-version fence to resolve accepted unknowns and retain later queue order", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    record = acceptReviewedPointScore(reconcilePointAttempts(record, 5, []).record);
    record = {
      ...record,
      pausedAfterError: false,
      unsent: [
        { id: "fence", side: "A", idempotencyKey: "key-fence" },
        { id: "b", side: "B", idempotencyKey: "key-b" },
      ],
    };
    const begun = beginPointAttempt(record, 5, true);

    const applied = markPointAttemptApplied(begun.record, "fence", 6);

    expect(applied.attempts).toEqual([]);
    expect(applied.unsent).toEqual([{ id: "b", side: "B", idempotencyKey: "key-b" }]);
    expect(applied.pausedAfterError).toBe(true);
  });

  it("keeps an accepted decision version immutable across a later no-key read", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    record = acceptReviewedPointScore(reconcilePointAttempts(record, 5, []).record);

    const later = reconcilePointAttempts(record, 6, []).record;

    expect(later.reviewedVersion).toBe(6);
    expect(later.attempts[0]).toMatchObject({
      id: "a",
      state: "accepted-no-key",
      reviewedVersion: 5,
    });
  });

  it("uses exact proof of a lost fence to close older accepted attempts but keeps B/C paused", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    record = acceptReviewedPointScore(reconcilePointAttempts(record, 5, []).record);
    record = {
      ...record,
      pausedAfterError: false,
      unsent: [
        { id: "d", side: "A", idempotencyKey: "key-d" },
        { id: "b", side: "B", idempotencyKey: "key-b" },
        { id: "c", side: "A", idempotencyKey: "key-c" },
      ],
    };
    record = beginPointAttempt(record, 5, true).record;
    record = markPointAttemptError(record, "d");
    record = {
      ...record,
      attempts: [
        ...record.attempts,
        {
          id: "later-a",
          side: "A",
          idempotencyKey: "key-later-a",
          expectedVersion: 6,
          state: "accepted-no-key",
          reviewedVersion: 5,
        },
      ],
    };

    const reconciled = reconcilePointAttempts(record, 6, ["key-d"]);

    expect(reconciled.appliedAttemptIds).toEqual(["d"]);
    expect(reconciled.fencedAttemptIds).toEqual(["a"]);
    expect(reconciled.record.attempts).toEqual([
      expect.objectContaining({ id: "later-a", expectedVersion: 6 }),
    ]);
    expect(reconciled.record.unsent.map((intent) => intent.id)).toEqual(["b", "c"]);
    expect(reconciled.record.pausedAfterError).toBe(true);
    expect(reconciled.record.readState).toBe("no-key");
  });

  it("discarding unsent intentions never clears an unknown attempt or unsafe storage", () => {
    let record = createScoreRecoveryRecord("u1", "m1", 5);
    record = appendPointIntent(record, { id: "a", side: "A", idempotencyKey: "key-a" });
    record = beginPointAttempt(record, 5).record;
    record = markPointAttemptError(record, "a");
    record = appendPointIntent(record, { id: "b", side: "B", idempotencyKey: "key-b" });
    record = { ...record, storageSafe: false };

    const discarded = discardUnsentPointIntents(record);

    expect(discarded.unsent).toEqual([]);
    expect(discarded.attempts).toHaveLength(1);
    expect(discarded.storageSafe).toBe(false);
    expect(discarded.pausedAfterError).toBe(true);
  });

  it("preserves SPA memory across remount after storage failure", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const record = markPointAttemptError(
      beginPointAttempt(
        appendPointIntent(
          createScoreRecoveryRecord("u1", "m1", 5),
          { id: "a", side: "A", idempotencyKey: "key-a" },
        ),
        5,
      ).record,
      "a",
    );
    rememberScoreRecoveryRecord({ ...record, storageSafe: false });

    expect(readScoreRecoveryRecord("u1", "m1", storage).record).toMatchObject({
      attempts: [expect.objectContaining({ id: "a", state: "unknown" })],
      storageSafe: false,
    });
  });

  it("fails closed on corrupt storage without deleting or interpreting unfamiliar keys", () => {
    const storage = new MemoryStorage();
    const key = scoreRecoveryStorageKey("u1", "m1");
    storage.values.set(key, "{broken-json");

    const restored = readScoreRecoveryRecord("u1", "m1", storage);

    expect(restored.record).toBeNull();
    expect(restored.storageError).toMatch(/поврежден/i);
    expect(storage.values.get(key)).toBe("{broken-json");
  });

  it("does not let safe SPA memory hide a later-corrupted durable record", () => {
    const storage = new MemoryStorage();
    const record = createScoreRecoveryRecord("u1", "m1", 5);
    persistScoreRecoveryRecord(record, storage);
    const key = scoreRecoveryStorageKey("u1", "m1");
    storage.values.set(key, "{broken-json");

    const restored = readScoreRecoveryRecord("u1", "m1", storage);

    expect(restored.record).toBeNull();
    expect(restored.storageError).toMatch(/поврежден/i);
    expect(storage.values.get(key)).toBe("{broken-json");
  });
});
