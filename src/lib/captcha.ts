import crypto from "node:crypto";
import { run } from "./db";
import { derivedKey, randomToken } from "./security";

/**
 * CAPTCHA for sign-up, login and password-reset requests.
 * - Built in (default, no account needed): a proof-of-work challenge. The visitor's browser finds a number
 *   whose hash starts with N zero bits (about a second), invisible to people but costly for bots at scale.
 *   Challenges are signed, expire after 10 minutes and can be used once.
 * - Cloudflare Turnstile: used automatically when TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set.
 */

export type CaptchaConfig = { mode: "turnstile"; siteKey: string } | { mode: "pow"; challenge: string };

export const turnstileEnabled = () => Boolean(process.env.TURNSTILE_SITE_KEY?.trim() && process.env.TURNSTILE_SECRET_KEY?.trim());
const bits = () => Math.min(22, Math.max(8, Number(process.env.CAPTCHA_BITS) || 16));
const TTL_MS = 10 * 60 * 1000;
const sign = (payload: string) => crypto.createHmac("sha256", derivedKey("captcha")).update(payload).digest("base64url");

export function createChallenge(now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ id: randomToken(12), salt: randomToken(12), exp: now + TTL_MS, bits: bits() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function captchaConfig(): CaptchaConfig {
  return turnstileEnabled() ? { mode: "turnstile", siteKey: process.env.TURNSTILE_SITE_KEY!.trim() } : { mode: "pow", challenge: createChallenge() };
}

export function leadingZeroBits(hex: string): number {
  let n = 0;
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    if (v === 0) { n += 4; continue; }
    return n + Math.clz32(v) - 28;
  }
  return n;
}

/** Checks a proof-of-work solution "payload.signature.nonce". Marks it used. Returns an error or null. */
export function verifyPow(token: string, now = Date.now()): string | null {
  const [payload, sig, nonce] = token.split(".");
  if (!payload || !sig || !nonce) return "missing";
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return "invalid";
  let c: { id: string; salt: string; exp: number; bits: number };
  try {
    c = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return "invalid";
  }
  if (c.exp < now) return "expired";
  const hash = crypto.createHash("sha256").update(`${c.salt}:${nonce}`).digest("hex");
  if (leadingZeroBits(hash) < c.bits) return "unsolved";
  run("DELETE FROM captcha_used WHERE exp < ?", now);
  if (run("INSERT OR IGNORE INTO captcha_used (id, exp) VALUES (?, ?)", c.id, c.exp).changes === 0) return "reused";
  return null;
}

async function verifyTurnstile(token: string, ip: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!.trim(), response: token, ...(ip && ip !== "unknown" ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    return Boolean(((await res.json()) as { success?: boolean }).success);
  } catch {
    return false;
  }
}

/** Verifies the CAPTCHA fields of a submitted form. Returns a user-facing error, or null when it passed. */
export async function checkCaptcha(form: FormData, ip: string): Promise<string | null> {
  if (process.env.DISABLE_CAPTCHA === "1") return null;
  if (String(form.get("website") ?? "")) return "Please try again."; // honeypot filled in: a bot
  if (turnstileEnabled()) {
    return (await verifyTurnstile(String(form.get("cf-turnstile-response") ?? ""), ip)) ? null : "Please complete the security check and try again.";
  }
  const r = verifyPow(String(form.get("captcha") ?? ""));
  if (r === null) return null;
  return r === "missing" || r === "unsolved"
    ? "The security check is still running. Wait a second and try again."
    : "The security check expired. Please try again.";
}
