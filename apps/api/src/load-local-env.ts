/**
 * Load apps/api/.env when it exists. Node does not overwrite variables that
 * are already present in the process environment, so CI and hosting settings
 * remain authoritative.
 */
export function loadLocalEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
