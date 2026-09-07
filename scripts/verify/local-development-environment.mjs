const HOSTED_EXACT_KEYS = new Set([
  "ALLOW_TEST_DATABASE_RESET",
  "AUDIT_EPHEMERAL",
  "COOKIE_SAME_SITE",
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "PGLITE_DATA_DIR",
  "TAB10_API_ORIGIN",
  "TAB10_MIGRATION_CONFIRM_SHA",
  "TAB10_RUNTIME_DATABASE_ROLE",
  "TAB10_SNAPSHOT_RESTORE_EVIDENCE_SHA256",
  "TAB10_STAGING_RESET_CONFIRM",
  "TAB10_WEB_ORIGIN",
  "TEST_DATABASE_URL",
]);

const HOSTED_PREFIXES = [
  "GITHUB_",
  "NEON_",
  "RENDER_",
  "TAB10_E2E_",
  "TAB10_EXPECTED_",
  "TAB10_FORBIDDEN_",
  "TAB10_NEON_",
  "TAB10_RENDER_",
  "TAB10_VERCEL_",
  "VERCEL_",
  "VITE_",
];

export function localDevelopmentBaseEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !HOSTED_EXACT_KEYS.has(key) &&
        !HOSTED_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}
