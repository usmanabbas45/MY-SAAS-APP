import crypto from "node:crypto";
import { all, get, run, transaction } from "./db";
import { decrypt, derivedKey, encrypt, sha256 } from "./security";

/**
 * Two-factor authentication with time-based one-time codes (TOTP, RFC 6238), compatible with Google
 * Authenticator, Microsoft Authenticator, Authy and 1Password. Secrets are stored encrypted; each code
 * works once; 10 single-use recovery codes cover a lost phone.
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Returns the matching time step (allowing ±1 step of clock drift), or null. */
export function matchTotp(secret: string, code: string, now = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const step = Math.floor(now / 1000 / STEP);
  for (const s of [step, step - 1, step + 1]) {
    const expected = Buffer.from(totpAt(secret, s));
    if (crypto.timingSafeEqual(expected, Buffer.from(c))) return s;
  }
  return null;
}

export const otpauthUrl = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent(`ProofMyAI:${email}`)}?secret=${secret}&issuer=ProofMyAI&algorithm=SHA1&digits=6&period=30`;

export const twoFactorEnabled = (userId: number) => Boolean(get<{ t: string | null }>("SELECT totp_enabled_at AS t FROM users WHERE id = ?", userId)?.t);

/** Starts setup: a new secret waits (encrypted) until the user proves they scanned it. */
export function startSetup(userId: number): string {
  const secret = base32Encode(crypto.randomBytes(20));
  run("UPDATE users SET totp_pending_enc = ? WHERE id = ?", encrypt(secret), userId);
  return secret;
}

export function pendingSecret(userId: number): string | null {
  const enc = get<{ s: string | null }>("SELECT totp_pending_enc AS s FROM users WHERE id = ?", userId)?.s;
  return enc ? decrypt(enc) : null;
}

const hashCode = (code: string) => sha256(`${derivedKey("recovery")}:${code.replace(/[^a-z0-9]/gi, "").toLowerCase()}`);

/** Confirms setup with a code from the app. Returns the recovery codes to show once, or null if the code is wrong. */
export function confirmSetup(userId: number, code: string, now = Date.now()): string[] | null {
  const secret = pendingSecret(userId);
  if (!secret) return null;
  const step = matchTotp(secret, code, now);
  if (step === null) return null;
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("hex").replace(/(.{5})/, "$1-"));
  transaction(() => {
    run("UPDATE users SET totp_secret_enc = ?, totp_pending_enc = NULL, totp_enabled_at = ?, totp_last_step = ? WHERE id = ?", encrypt(secret), new Date(now).toISOString(), step, userId);
    run("DELETE FROM recovery_codes WHERE user_id = ?", userId);
    for (const c of codes) run("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)", userId, hashCode(c));
  });
  return codes;
}

/** Checks a login code: a 6-digit app code (each works once) or an unused recovery code. */
export function verifySecondFactor(userId: number, code: string, now = Date.now()): { ok: boolean; usedRecovery?: boolean } {
  const row = get<{ s: string | null; last: number | null }>("SELECT totp_secret_enc AS s, totp_last_step AS last FROM users WHERE id = ?", userId);
  if (!row?.s) return { ok: false };
  const step = matchTotp(decrypt(row.s), code, now);
  if (step !== null) {
    if (row.last !== null && step <= row.last) return { ok: false }; // replayed code
    run("UPDATE users SET totp_last_step = ? WHERE id = ?", step, userId);
    return { ok: true };
  }
  const used = run("UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL", new Date(now).toISOString(), userId, hashCode(code));
  return used.changes ? { ok: true, usedRecovery: true } : { ok: false };
}

export function disableTwoFactor(userId: number): void {
  transaction(() => {
    run("UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?", userId);
    run("DELETE FROM recovery_codes WHERE user_id = ?", userId);
  });
}

export const recoveryCodesLeft = (userId: number) =>
  all("SELECT 1 FROM recovery_codes WHERE user_id = ? AND used_at IS NULL", userId).length;

// ---------- Pending login (password OK, waiting for the 2FA code) ----------

const sign = (s: string) => crypto.createHmac("sha256", derivedKey("2fa-login")).update(s).digest("base64url");

export function pendingLoginToken(userId: number, now = Date.now()): string {
  const body = `${userId}.${now + 5 * 60 * 1000}`;
  return `${body}.${sign(body)}`;
}

export function readPendingLogin(token: string, now = Date.now()): number | null {
  const [id, exp, sig] = token.split(".");
  if (!id || !exp || !sig) return null;
  const expected = Buffer.from(sign(`${id}.${exp}`));
  if (expected.length !== Buffer.from(sig).length || !crypto.timingSafeEqual(expected, Buffer.from(sig))) return null;
  return Number(exp) > now ? Number(id) : null;
}
