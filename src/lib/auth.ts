import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { get, run } from "./db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./security";

const COOKIE = "ap_session";
const SESSION_DAYS = 30;

export interface User {
  id: number;
  email: string;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";
  return null;
}

export function createUser(email: string, password: string): { user?: User; error?: string } {
  const e = normaliseEmail(email);
  const problem = validateCredentials(e, password);
  if (problem) return { error: problem };
  if (get("SELECT id FROM users WHERE email = ?", e)) return { error: "An account with this email already exists. Log in instead." };
  const { lastInsertRowid } = run("INSERT INTO users (email, password_hash) VALUES (?, ?)", e, hashPassword(password));
  return { user: { id: lastInsertRowid, email: e } };
}

export function checkLogin(email: string, password: string): User | null {
  const row = get<{ id: number; email: string; password_hash: string }>(
    "SELECT id, email, password_hash FROM users WHERE email = ?", normaliseEmail(email),
  );
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email };
}

/** True when an admin has suspended this account (it can't log in or use the API). */
export function isSuspended(userId: number): boolean {
  return Boolean(get<{ s: string | null }>("SELECT suspended_at AS s FROM users WHERE id = ?", userId)?.s);
}

export async function startSession(userId: number): Promise<void> {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", sha256(token), userId, expires.toISOString());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = get<{ id: number; email: string; expires_at: string; suspended_at: string | null; last_seen_at: string | null }>(
    "SELECT u.id, u.email, s.expires_at, u.suspended_at, u.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?", sha256(token),
  );
  if (!row || row.suspended_at || Date.parse(row.expires_at) < Date.now()) return null;
  // "Last active" for the admin dashboard, written at most every 10 minutes.
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 600000) {
    run("UPDATE users SET last_seen_at = ? WHERE id = ?", new Date().toISOString(), row.id);
  }
  return { id: row.id, email: row.email };
}

/** Hash of the current session token, used to keep this device signed in after a password change. */
export async function currentSessionHash(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? sha256(token) : null;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
