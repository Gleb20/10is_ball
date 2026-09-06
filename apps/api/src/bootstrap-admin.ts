import {
  LoginRequestSchema,
  normalizeEmail,
  validatePassword,
} from "@tab10/shared";

type BootstrapEnvironment = Readonly<Record<string, string | undefined>>;

export type BootstrapAdminConfig =
  | { enabled: false }
  | { enabled: true; email: string; password: string };

export type BootstrapAdminOutcome =
  | "disabled"
  | "existing"
  | "provisioned";

type BootstrapAdminAccount = {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "active" | "blocked";
};

type BootstrapAdminSeedResult = {
  user: BootstrapAdminAccount;
  created: boolean;
};

type BootstrapAdminAuth = {
  listUsers(q?: string): Promise<readonly BootstrapAdminAccount[]>;
  seedAdmin(email: string, password: string): Promise<BootstrapAdminSeedResult>;
};

const KNOWN_UNSAFE_PASSWORDS = new Set(["adminpass1!"]);

/**
 * Resolve the one-time admin bootstrap configuration without permissive
 * defaults. Invalid opt-in is a startup error rather than a partial bootstrap.
 */
export function resolveBootstrapAdminConfig(
  env: BootstrapEnvironment,
): BootstrapAdminConfig {
  const flag = env.SEED_ADMIN?.trim();
  if (flag === undefined || flag === "" || flag === "0") {
    return { enabled: false };
  }
  if (flag !== "1") {
    throw new Error("SEED_ADMIN must be either 0 or 1");
  }

  const rawEmail = env.SEED_ADMIN_EMAIL;
  if (!rawEmail?.trim()) {
    throw new Error("SEED_ADMIN_EMAIL is required when SEED_ADMIN=1");
  }
  const email = normalizeEmail(rawEmail);
  if (!LoginRequestSchema.shape.email.safeParse(email).success) {
    throw new Error("SEED_ADMIN_EMAIL must be a valid email address");
  }

  const password = env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error("SEED_ADMIN_PASSWORD is required when SEED_ADMIN=1");
  }
  const validation = validatePassword(password);
  if (!validation.ok) {
    throw new Error(
      `SEED_ADMIN_PASSWORD does not meet password policy (${validation.errors.join(
        ",",
      )})`,
    );
  }
  if (KNOWN_UNSAFE_PASSWORDS.has(password.toLowerCase())) {
    throw new Error("SEED_ADMIN_PASSWORD is a known unsafe bootstrap password");
  }

  return { enabled: true, email, password };
}

/**
 * Provision the explicitly configured admin account. A pre-existing account is
 * never modified: bootstrap is account creation, not password rotation.
 */
export async function ensureBootstrapAdmin(
  auth: BootstrapAdminAuth,
  config: BootstrapAdminConfig,
  log: (message: string) => void = console.info,
): Promise<BootstrapAdminOutcome> {
  if (!config.enabled) return "disabled";

  const users = await auth.listUsers(config.email);
  const existing = users.find(
    (user) => normalizeEmail(user.email) === config.email,
  );
  if (existing) {
    if (existing.role !== "admin" || existing.status !== "active") {
      throw new Error(
        "Bootstrap email belongs to an account that is not an active admin",
      );
    }
    log("Bootstrap admin already exists; its password was not changed.");
    return "existing";
  }

  const seeded = await auth.seedAdmin(config.email, config.password);
  const provisioned = seeded.user;
  if (
    normalizeEmail(provisioned.email) !== config.email ||
    provisioned.role !== "admin" ||
    provisioned.status !== "active"
  ) {
    throw new Error(
      "Bootstrap provisioning did not yield the requested active admin account",
    );
  }

  if (!seeded.created) {
    log(
      `Bootstrap admin appeared concurrently (${provisioned.id}); its password was not changed.`,
    );
    return "existing";
  }

  log(
    `Bootstrap admin provisioning completed (${provisioned.id}). Bootstrap never rotates passwords for pre-existing accounts.`,
  );
  return "provisioned";
}
