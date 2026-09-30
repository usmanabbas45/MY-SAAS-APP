/**
 * Password strength rules, shared by the browser (live checklist) and the server (final check).
 * No Node imports: this file runs in both.
 */

export const MIN_LENGTH = 10;
/** Long passphrases ("correct horse battery staple") don't need symbols or capitals. */
export const PASSPHRASE_LENGTH = 16;

// Frequently leaked passwords and words attackers try first. Compared after removing digits/symbols at the ends.
const COMMON = new Set([
  "password", "passw0rd", "p@ssword", "p@ssw0rd", "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbnm", "letmein", "welcome", "admin",
  "administrator", "login", "iloveyou", "monkey", "dragon", "football", "baseball", "sunshine", "princess", "master", "shadow", "superman",
  "trustno1", "abc123", "abcdef", "abcdefg", "abcdefgh", "starwars", "whatever", "freedom", "secret", "changeme", "default", "computer",
  "internet", "hello", "hellohello", "summer", "winter", "spring", "autumn", "flower", "pakistan", "karachi", "lahore", "islamabad", "india",
  "london", "america", "google", "facebook", "whatsapp", "instagram", "microsoft", "apple", "samsung", "proofmyai", "proofmy", "chatbot",
  "qazwsx", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "q1w2e3r4", "passwordpassword", "mypassword", "yourpassword", "newpassword", "test", "testing",
  "tester", "guest", "user", "username", "root", "toor", "pass", "passpass", "pakistan123", "allah", "muhammad", "bismillah", "cricket",
]);

const SEQUENCES = ["0123456789", "9876543210", "abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba", "qwertyuiop", "asdfghjkl", "zxcvbnm", "qazwsxedc"];

export interface PasswordCheck {
  ok: boolean;
  /** 0 (very weak) to 4 (strong), for the meter. */
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too weak" | "Weak" | "Fair" | "Good" | "Strong";
  rules: { id: string; text: string; ok: boolean }[];
  /** First failing rule, as a sentence for error messages. */
  problem: string | null;
}

const classes = (pw: string) =>
  [/[a-z]/.test(pw), /[A-Z]/.test(pw), /\d/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;

function isCommon(pw: string): boolean {
  const core = pw.toLowerCase().replace(/^[\d\W_]+|[\d\W_]+$/g, "");
  return COMMON.has(pw.toLowerCase()) || (core.length > 0 && COMMON.has(core)) || /^\d+$/.test(pw);
}

function hasPattern(pw: string): boolean {
  const lower = pw.toLowerCase();
  if (/(.)\1{3,}/.test(lower)) return true; // aaaa, 1111
  return SEQUENCES.some((seq) => {
    for (let i = 0; i + 5 <= seq.length; i++) if (lower.includes(seq.slice(i, i + 5))) return true;
    return false;
  });
}

export function checkPassword(pw: string, email = ""): PasswordCheck {
  const name = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  const passphrase = pw.length >= PASSPHRASE_LENGTH;
  const rules = [
    { id: "length", text: `At least ${MIN_LENGTH} characters`, ok: pw.length >= MIN_LENGTH },
    { id: "mix", text: `Mix of 3: lowercase, UPPERCASE, numbers, symbols (or ${PASSPHRASE_LENGTH}+ characters)`, ok: passphrase || classes(pw) >= 3 },
    { id: "common", text: "Not a common or easy-to-guess password", ok: pw.length > 0 && !isCommon(pw) && !hasPattern(pw) },
    { id: "personal", text: "Doesn't contain your email name", ok: !(name.length >= 4 && pw.toLowerCase().includes(name)) },
  ];
  const tooLong = pw.length > 200;
  const ok = rules.every((r) => r.ok) && !tooLong;
  // Score: rules passed, plus a bonus for length and variety.
  let points = rules.filter((r) => r.ok).length;
  if (ok && (pw.length >= 14 || (classes(pw) === 4 && pw.length >= 12))) points++;
  const score = (ok ? Math.max(3, Math.min(4, points - 1)) : Math.min(2, Math.max(0, points - 1))) as PasswordCheck["score"];
  const label = (["Too weak", "Weak", "Fair", "Good", "Strong"] as const)[score];
  const failing = rules.find((r) => !r.ok);
  const problem = tooLong ? "Password is too long (200 characters max)."
    : failing?.id === "length" ? `Use at least ${MIN_LENGTH} characters.`
    : failing?.id === "mix" ? `Mix at least 3 of: lowercase, UPPERCASE, numbers and symbols, or use a passphrase of ${PASSPHRASE_LENGTH}+ characters.`
    : failing?.id === "common" ? "This password is too common or easy to guess. Try a few random words with a number or symbol."
    : failing?.id === "personal" ? "Don't use your email name in your password."
    : null;
  return { ok, score, label, rules, problem };
}
