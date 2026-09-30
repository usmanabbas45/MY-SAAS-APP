import { all, get, run } from "./db";

/**
 * Emails ("name@company.com") or whole domains ("@company.com") that may not sign up.
 * Blocking also suspends matching existing accounts, so they can't log in or send data.
 */

export interface BlockEntry { id: number; pattern: string; reason: string | null; created_by: string | null; created_at: string }

/** Normalises input to "name@x.com" or "@x.com"; returns null when it is neither. */
export function normalisePattern(input: string): string | null {
  const v = input.trim().toLowerCase();
  if (!/^\*?@/.test(v) && /^[a-z0-9._%+-]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  const domain = v.replace(/^\*?@/, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return `@${domain}`;
  return null;
}

export function isBlocked(email: string): boolean {
  const e = email.trim().toLowerCase();
  const domain = e.split("@")[1] ?? "";
  // "@company.com" also covers subdomains like "@mail.company.com".
  const parts = domain.split(".");
  const domains = parts.slice(0, -1).map((_, i) => `@${parts.slice(i).join(".")}`);
  const patterns = [e, ...domains];
  return Boolean(get(`SELECT 1 FROM blocklist WHERE pattern IN (${patterns.map(() => "?").join(",")})`, ...patterns));
}

function matchingUsers(pattern: string): { id: number; email: string }[] {
  return pattern.startsWith("@")
    ? all("SELECT id, email FROM users WHERE email LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'", `%${esc(pattern)}`, `%.${esc(pattern.slice(1))}`)
    : all("SELECT id, email FROM users WHERE email = ?", pattern);
}
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Adds a block and suspends matching accounts (never the admins). Returns the accounts suspended. */
export function addBlock(input: string, reason: string, admin: string, protectedEmails: (email: string) => boolean): { pattern?: string; suspended?: string[]; error?: string } {
  const pattern = normalisePattern(input);
  if (!pattern) return { error: "Enter an email (name@company.com) or a domain (@company.com)." };
  if (protectedEmails(pattern) || matchingUsers(pattern).some((u) => protectedEmails(u.email))) return { error: "That would block an admin account." };
  if (get("SELECT 1 FROM blocklist WHERE pattern = ?", pattern)) return { error: `${pattern} is already blocked.` };
  run("INSERT INTO blocklist (pattern, reason, created_by) VALUES (?, ?, ?)", pattern, reason.trim().slice(0, 300) || null, admin);
  const now = new Date().toISOString();
  const users = matchingUsers(pattern);
  for (const u of users) {
    run("UPDATE users SET suspended_at = COALESCE(suspended_at, ?) WHERE id = ?", now, u.id);
    run("DELETE FROM sessions WHERE user_id = ?", u.id);
  }
  return { pattern, suspended: users.map((u) => u.email) };
}

export function removeBlock(id: number): string | null {
  const row = get<{ pattern: string }>("SELECT pattern FROM blocklist WHERE id = ?", id);
  run("DELETE FROM blocklist WHERE id = ?", id);
  return row?.pattern ?? null;
}

export function listBlocks(): BlockEntry[] {
  return all<BlockEntry>("SELECT * FROM blocklist ORDER BY id DESC");
}
