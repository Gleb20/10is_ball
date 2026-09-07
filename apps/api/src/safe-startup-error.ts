const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s'"`]+/gi;
const DATABASE_ENV_PATTERN = /\b(?:TEST_)?DATABASE_URL=\S+/gi;

export function safeStartupErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unknown startup error";
  return raw
    .replace(DATABASE_URL_PATTERN, "[REDACTED_DATABASE_URL]")
    .replace(DATABASE_ENV_PATTERN, "DATABASE_URL=[REDACTED]");
}
