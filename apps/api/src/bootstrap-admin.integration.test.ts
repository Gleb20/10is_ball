import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq } from "drizzle-orm";
import { createPgliteDb } from "./db/client.js";
import { auditLogs } from "./db/schema.js";
import { AuthService } from "./modules/auth/auth-service.js";

describe("bootstrap admin persistence", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("atomically distinguishes concurrent create/existing and writes one audit record", async () => {
    const context = await createPgliteDb();
    close = context.close;
    const auth = new AuthService(context.db, new FakeClock());

    const outcomes = await Promise.all([
      auth.seedAdmin("owner@tab10.local", "UniqueAdmin2!"),
      auth.seedAdmin("owner@tab10.local", "UniqueAdmin2!"),
    ]);

    expect(outcomes.map((outcome) => outcome.created).sort()).toEqual([
      false,
      true,
    ]);
    expect(new Set(outcomes.map((outcome) => outcome.user.id)).size).toBe(1);

    const audit = await context.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "admin.bootstrap_provisioned"),
          eq(auditLogs.entityId, outcomes[0]!.user.id),
        ),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBeNull();
    expect(audit[0]!.meta).toEqual({ source: "startup-bootstrap" });
  });
});
