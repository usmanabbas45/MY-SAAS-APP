import { all, get, run, transaction } from "./db";
import { sendMail } from "./email";
import { passwordResetEmail } from "./emails";
import { checkPassword } from "./password";
import { hashPassword, randomToken, sha256, verifyPassword } from "./security";

export const RESET_MINUTES = 60;

/** Strength rules (see lib/password.ts). The breach-database check runs in the server actions. */
export function passwordProblem(password: string, email = ""): string | null {
  return checkPassword(password, email).problem;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Creates a single-use reset token (stored hashed) and emails the link. Never reveals whether the email exists. */
export async function requestPasswordReset(email: string, appUrl: string): Promise<{ token: string | null }> {
  const user = get<{ id: number; email: string }>("SELECT id, email FROM users WHERE email = ?", email.trim().toLowerCase());
  if (!user) return { token: null };
  run("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?", user.id, new Date().toISOString());
  const token = randomToken(32);
  run("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    sha256(token), user.id, new Date(Date.now() + RESET_MINUTES * 60000).toISOString());
  const link = `${appUrl.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail(user.email, passwordResetEmail(link, RESET_MINUTES));
  return { token };
}

export function resetTokenValid(token: string): boolean {
  const row = get<{ expires_at: string; used: number }>("SELECT expires_at, used FROM password_resets WHERE token_hash = ?", sha256(token));
  return Boolean(row && !row.used && Date.parse(row.expires_at) > Date.now());
}

/** Sets a new password from a reset token and signs the user out everywhere. */
export function resetPassword(token: string, password: string): { ok: true; userId: number } | { ok: false; error: string } {
  const row = get<{ user_id: number; expires_at: string; used: number; email: string }>(
    "SELECT r.user_id, r.expires_at, r.used, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?", sha256(token),
  );
  if (!row || row.used || Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, error: "This reset link has expired or was already used. Request a new one." };
  }
  const problem = passwordProblem(password, row.email);
  if (problem) return { ok: false, error: problem };
  transaction(() => {
    run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), row.user_id);
    run("UPDATE password_resets SET used = 1 WHERE user_id = ?", row.user_id);
    run("DELETE FROM sessions WHERE user_id = ?", row.user_id);
  });
  return { ok: true, userId: row.user_id };
}

export const currentPasswordOk = (userId: number, password: string) => currentPasswordMatches(userId, password);

function currentPasswordMatches(userId: number, password: string): boolean {
  const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", userId);
  return Boolean(row && verifyPassword(password, row.password_hash));
}

/** Changes the password and signs out every other device (keeps the current session). */
export function changePassword(userId: number, current: string, next: string, keepSessionHash: string | null): string | null {
  if (!currentPasswordMatches(userId, current)) return "Your current password is wrong.";
  const problem = passwordProblem(next, get<{ email: string }>("SELECT email FROM users WHERE id = ?", userId)?.email ?? "");
  if (problem) return problem;
  transaction(() => {
    run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(next), userId);
    run("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", userId, keepSessionHash ?? "");
  });
  return null;
}

export function signOutOtherDevices(userId: number, keepSessionHash: string | null): number {
  return run("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", userId, keepSessionHash ?? "").changes;
}

export function activeSessions(userId: number): number {
  return all("SELECT 1 FROM sessions WHERE user_id = ? AND expires_at > ?", userId, new Date().toISOString()).length;
}

/** Permanently deletes the user and (via foreign keys) all their projects and data. */
export function deleteAccount(userId: number, password: string): string | null {
  if (!currentPasswordMatches(userId, password)) return "Wrong password. Your account was not deleted.";
  run("DELETE FROM users WHERE id = ?", userId);
  return null;
}
