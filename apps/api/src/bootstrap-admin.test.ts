import { describe, expect, it, vi } from "vitest";
import {
  ensureBootstrapAdmin,
  resolveBootstrapAdminConfig,
  type BootstrapAdminConfig,
} from "./bootstrap-admin.js";

const ACTIVE_ADMIN = {
  id: "admin-1",
  email: "owner@tab10.local",
  role: "admin" as const,
  status: "active" as const,
};

describe("resolveBootstrapAdminConfig", () => {
  it("is disabled by default, including in production", () => {
    expect(resolveBootstrapAdminConfig({ NODE_ENV: "production" })).toEqual({
      enabled: false,
    });
    expect(
      resolveBootstrapAdminConfig({
        NODE_ENV: "production",
        SEED_ADMIN: "0",
      }),
    ).toEqual({ enabled: false });
  });

  it("requires the exact 0/1 flag values", () => {
    expect(() =>
      resolveBootstrapAdminConfig({ SEED_ADMIN: "true" }),
    ).toThrow("SEED_ADMIN must be either 0 or 1");
  });

  it("requires an explicit valid email and strong password", () => {
    expect(() =>
      resolveBootstrapAdminConfig({ SEED_ADMIN: "1" }),
    ).toThrow("SEED_ADMIN_EMAIL is required");
    expect(() =>
      resolveBootstrapAdminConfig({
        SEED_ADMIN: "1",
        SEED_ADMIN_EMAIL: "owner@tab10.local",
      }),
    ).toThrow("SEED_ADMIN_PASSWORD is required");
    expect(() =>
      resolveBootstrapAdminConfig({
        SEED_ADMIN: "1",
        SEED_ADMIN_EMAIL: "not-an-email",
        SEED_ADMIN_PASSWORD: "UniqueAdmin2!",
      }),
    ).toThrow("valid email address");
    expect(() =>
      resolveBootstrapAdminConfig({
        SEED_ADMIN: "1",
        SEED_ADMIN_EMAIL: "owner@tab10.local",
        SEED_ADMIN_PASSWORD: "weak",
      }),
    ).toThrow("does not meet password policy");
  });

  it("rejects the former repository default even though it matches policy", () => {
    expect(() =>
      resolveBootstrapAdminConfig({
        SEED_ADMIN: "1",
        SEED_ADMIN_EMAIL: "owner@tab10.local",
        SEED_ADMIN_PASSWORD: "AdminPass1!",
      }),
    ).toThrow("known unsafe bootstrap password");
  });

  it("normalizes a valid explicit configuration", () => {
    expect(
      resolveBootstrapAdminConfig({
        SEED_ADMIN: " 1 ",
        SEED_ADMIN_EMAIL: " Owner@Tab10.Local ",
        SEED_ADMIN_PASSWORD: "UniqueAdmin2!",
      }),
    ).toEqual({
      enabled: true,
      email: "owner@tab10.local",
      password: "UniqueAdmin2!",
    });
  });

  it("does not include the rejected password in an error", () => {
    const rejectedPassword = "private-but-weak";
    expect(() =>
      resolveBootstrapAdminConfig({
        SEED_ADMIN: "1",
        SEED_ADMIN_EMAIL: "owner@tab10.local",
        SEED_ADMIN_PASSWORD: rejectedPassword,
      }),
    ).toThrowError(expect.not.stringContaining(rejectedPassword));
  });
});

describe("ensureBootstrapAdmin", () => {
  const enabled: BootstrapAdminConfig = {
    enabled: true,
    email: ACTIVE_ADMIN.email,
    password: "UniqueAdmin2!",
  };

  it("does not query or seed while disabled", async () => {
    const auth = {
      listUsers: vi.fn(),
      seedAdmin: vi.fn(),
    };

    await expect(
      ensureBootstrapAdmin(auth, { enabled: false }),
    ).resolves.toBe("disabled");
    expect(auth.listUsers).not.toHaveBeenCalled();
    expect(auth.seedAdmin).not.toHaveBeenCalled();
  });

  it("leaves an existing active admin password unchanged", async () => {
    const auth = {
      listUsers: vi.fn().mockResolvedValue([ACTIVE_ADMIN]),
      seedAdmin: vi.fn(),
    };
    const log = vi.fn();

    await expect(ensureBootstrapAdmin(auth, enabled, log)).resolves.toBe(
      "existing",
    );
    expect(auth.seedAdmin).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("password was not changed"),
    );
  });

  it.each([
    { ...ACTIVE_ADMIN, role: "user" as const },
    { ...ACTIVE_ADMIN, status: "blocked" as const },
  ])("fails closed for an incompatible existing account", async (account) => {
    const auth = {
      listUsers: vi.fn().mockResolvedValue([account]),
      seedAdmin: vi.fn(),
    };

    await expect(ensureBootstrapAdmin(auth, enabled)).rejects.toThrow(
      "not an active admin",
    );
    expect(auth.seedAdmin).not.toHaveBeenCalled();
  });

  it("provisions a missing admin with the explicit credentials", async () => {
    const auth = {
      listUsers: vi.fn().mockResolvedValue([]),
      seedAdmin: vi.fn().mockResolvedValue({
        user: ACTIVE_ADMIN,
        created: true,
      }),
    };
    const log = vi.fn();

    await expect(ensureBootstrapAdmin(auth, enabled, log)).resolves.toBe(
      "provisioned",
    );
    expect(auth.seedAdmin).toHaveBeenCalledWith(
      ACTIVE_ADMIN.email,
      enabled.password,
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("never rotates passwords"),
    );
  });

  it("reports an account created concurrently as existing", async () => {
    const auth = {
      listUsers: vi.fn().mockResolvedValue([]),
      seedAdmin: vi.fn().mockResolvedValue({
        user: ACTIVE_ADMIN,
        created: false,
      }),
    };
    const log = vi.fn();

    await expect(ensureBootstrapAdmin(auth, enabled, log)).resolves.toBe(
      "existing",
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("concurrently"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining(ACTIVE_ADMIN.id));
  });
});
