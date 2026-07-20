/**
 * AUTH-003 / AT-AUTH-003 — password policy.
 */
export type PasswordPolicyError =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "MISSING_UPPERCASE"
  | "MISSING_LOWERCASE"
  | "MISSING_DIGIT"
  | "MISSING_SPECIAL";

export type PasswordValidationResult =
  | { ok: true }
  | { ok: false; errors: PasswordPolicyError[] };

const SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

export function validatePassword(password: string): PasswordValidationResult {
  const errors: PasswordPolicyError[] = [];
  if (password.length < 10) errors.push("TOO_SHORT");
  if (password.length > 128) errors.push("TOO_LONG");
  if (!/[A-Z]/.test(password)) errors.push("MISSING_UPPERCASE");
  if (!/[a-z]/.test(password)) errors.push("MISSING_LOWERCASE");
  if (!/[0-9]/.test(password)) errors.push("MISSING_DIGIT");
  if (!SPECIAL.test(password)) errors.push("MISSING_SPECIAL");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

const AMBIGUOUS = new Set(["O", "0", "l", "1", "I"]);

/**
 * Generate a temporary password that always satisfies policy.
 */
export function generateTemporaryPassword(
  length: number,
  randomByte: () => number,
): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%^&*";
  const all = `${upper}${lower}${digits}${special}`;

  const pick = (alphabet: string) =>
    alphabet[randomByte() % alphabet.length]!;

  const chars: string[] = [
    pick(upper),
    pick(lower),
    pick(digits),
    pick(special),
  ];

  const target = Math.max(16, Math.min(20, length));
  while (chars.length < target) {
    let c = pick(all);
    // Prefer non-ambiguous but keep entropy if exhausted retries
    let tries = 0;
    while (AMBIGUOUS.has(c) && tries < 5) {
      c = pick(all);
      tries += 1;
    }
    chars.push(c);
  }

  // Fisher–Yates with provided RNG
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomByte() % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join("");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
