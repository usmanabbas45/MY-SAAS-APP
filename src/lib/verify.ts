import { emailConfigured } from "./account";
import { get, run } from "./db";
import { sendMail } from "./email";
import { verifyEmail } from "./emails";
import { randomToken, sha256 } from "./security";
import { SITE_URL } from "./seo";

/**
 * Email verification. New accounts get a confirmation link; until it's clicked the account can use the
 * dashboard but can't make ProofMyAI email other people (team invitations, extra alert addresses), so
 * sign-ups with fake or mistyped addresses can't be used to send spam. When email isn't configured on
 * the server, accounts are verified automatically.
 */
export const VERIFY_HOURS = 48;

export function isVerified(userId: number): boolean {
  return Boolean(get<{ v: string | null }>("SELECT email_verified_at AS v FROM users WHERE id = ?", userId)?.v);
}

export function markVerified(userId: number): void {
  run("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", new Date().toISOString(), userId);
  run("DELETE FROM email_verifications WHERE user_id = ?", userId);
}

/** Emails a fresh confirmation link (older links stop working). Returns "verified" when email isn't set up. */
export async function sendVerification(userId: number, appUrl = process.env.APP_URL || SITE_URL): Promise<"sent" | "verified" | "already"> {
  const user = get<{ email: string; v: string | null }>("SELECT email, email_verified_at AS v FROM users WHERE id = ?", userId);
  if (!user) throw new Error("Account not found.");
  if (user.v) return "already";
  if (!emailConfigured()) {
    markVerified(userId);
    return "verified";
  }
  run("DELETE FROM email_verifications WHERE user_id = ? OR expires_at < ?", userId, new Date().toISOString());
  const token = randomToken(32);
  run("INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES (?, ?, ?)", sha256(token), userId, new Date(Date.now() + VERIFY_HOURS * 3600000).toISOString());
  const link = `${appUrl.replace(/\/+$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail(user.email, verifyEmail(link, VERIFY_HOURS));
  return "sent";
}

/** Confirms the email for a link token. Returns the user id, or null when the link is wrong or expired. */
export function confirmEmail(token: string): number | null {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) return null;
  const row = get<{ user_id: number; expires_at: string }>("SELECT user_id, expires_at FROM email_verifications WHERE token_hash = ?", sha256(token));
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  markVerified(row.user_id);
  return row.user_id;
}

/** Message shown when an unverified account tries something that emails another person. */
export const VERIFY_FIRST = "Please confirm your email address first. We sent you a link when you signed up; use \"Resend link\" at the top of the page if you can't find it.";
