import { notFound, redirect } from "next/navigation";
import { requireUser, type User } from "./auth";
import { billingState, PLANS, usage, yearlyPrice, type PlanId } from "./billing";
import { all, get, run } from "./db";
import { twoFactorEnabled } from "./twofactor";

/** Admins are listed in ADMIN_EMAILS (comma-separated); falls back to UNLIMITED_EMAILS. */
export function isAdmin(email: string): boolean {
  const list = process.env.ADMIN_EMAILS?.trim() || process.env.UNLIMITED_EMAILS || "";
  return list.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

/** Addresses that receive system emails (backups, error alerts). */
export function adminEmails(): string[] {
  const list = process.env.ADMIN_EMAILS?.trim() || process.env.UNLIMITED_EMAILS || "";
  return [...new Set(list.split(",").map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
}

/**
 * Loads the current user and hides the page (404) from anyone who is not an admin. The admin area controls
 * every account, so it also requires two-factor login (set ADMIN_REQUIRE_2FA=0 to switch this off).
 */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user.email)) notFound();
  if (process.env.ADMIN_REQUIRE_2FA !== "0" && !twoFactorEnabled(user.id)) {
    redirect(`/app/account?error=${encodeURIComponent("Turn on two-factor authentication to open the admin area. It protects every customer account if your password is ever stolen.")}#twofactor`);
  }
  return user;
}

export function logAdmin(admin: string, action: string, target: string | null, detail = ""): void {
  run("INSERT INTO admin_log (admin_email, action, target_email, detail) VALUES (?, ?, ?, ?)", admin, action, target, detail.slice(0, 500));
}

const n = (sql: string, ...args: (string | number)[]) => get<{ n: number }>(sql, ...args)?.n ?? 0;
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString().replace("T", " ").slice(0, 19);
const PAID = "plan IN ('starter','growth','agency','compliance')";

export interface AdminStats {
  users: number;
  new7: number;
  new30: number;
  active7: number;
  paying: number;
  trialing: number;
  pastDue: number;
  canceling: number;
  comped: number;
  suspended: number;
  mrr: number;
  byPlan: { plan: PlanId; paying: number; yearly: number; trialing: number }[];
  signups: { day: string; count: number }[];
  projects: number;
  conversations30: number;
  agentRuns30: number;
  workflowRuns30: number;
  openIncidents: number;
}

export function adminStats(): AdminStats {
  const byPlan = (["starter", "growth", "agency", "compliance"] as PlanId[]).map((plan) => ({
    plan,
    paying: n("SELECT COUNT(*) AS n FROM users WHERE plan = ? AND plan_status IN ('active','past_due')", plan),
    yearly: n("SELECT COUNT(*) AS n FROM users WHERE plan = ? AND plan_status IN ('active','past_due') AND plan_interval = 'year'", plan),
    trialing: n("SELECT COUNT(*) AS n FROM users WHERE plan = ? AND plan_status = 'trialing'", plan),
  }));
  // created_at is "YYYY-MM-DD HH:MM:SS" (SQLite datetime), so compare with the same format.
  const rows = all<{ day: string; count: number }>(
    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM users WHERE created_at >= ? GROUP BY day", daysAgo(29).slice(0, 10),
  );
  const signups = Array.from({ length: 30 }, (_, i) => {
    const day = daysAgo(29 - i).slice(0, 10);
    return { day, count: rows.find((r) => r.day === day)?.count ?? 0 };
  });
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  return {
    users: n("SELECT COUNT(*) AS n FROM users"),
    new7: n("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", daysAgo(7)),
    new30: n("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", daysAgo(30)),
    active7: n("SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?", new Date(Date.now() - 7 * 86400000).toISOString()),
    paying: n(`SELECT COUNT(*) AS n FROM users WHERE ${PAID} AND plan_status IN ('active','past_due')`),
    trialing: n(`SELECT COUNT(*) AS n FROM users WHERE ${PAID} AND plan_status = 'trialing'`),
    pastDue: n(`SELECT COUNT(*) AS n FROM users WHERE ${PAID} AND plan_status = 'past_due'`),
    canceling: n(`SELECT COUNT(*) AS n FROM users WHERE plan_cancel_at IS NOT NULL AND plan_status IN ('active','trialing','past_due')`),
    comped: n("SELECT COUNT(*) AS n FROM users WHERE plan_status = 'comped'"),
    suspended: n("SELECT COUNT(*) AS n FROM users WHERE suspended_at IS NOT NULL"),
    // Yearly subscriptions count as their yearly price spread over 12 months.
    mrr: Math.round(byPlan.reduce((sum, p) => sum + (p.paying - p.yearly) * PLANS[p.plan].price + (p.yearly * yearlyPrice(p.plan)) / 12, 0)),
    byPlan,
    signups,
    projects: n("SELECT COUNT(*) AS n FROM projects"),
    conversations30: n(
      "SELECT COUNT(DISTINCT audit_id || ':' || conversation_id) AS n FROM audit_items WHERE created_at >= ?", since30,
    ),
    agentRuns30: n("SELECT COUNT(*) AS n FROM agent_runs WHERE created_at >= ?", daysAgo(30)),
    workflowRuns30: n("SELECT COUNT(*) AS n FROM workflow_runs WHERE started_at >= ?", since30),
    openIncidents: n("SELECT COUNT(*) AS n FROM incidents WHERE resolved = 0"),
  };
}

export const SEGMENTS = {
  all: { label: "All users", where: "1=1" },
  paying: { label: "Paying", where: `${PAID} AND plan_status IN ('active','past_due')` },
  trialing: { label: "On trial", where: `${PAID} AND plan_status = 'trialing'` },
  free: { label: "Free", where: `NOT (${PAID} AND plan_status IN ('active','trialing','past_due','comped'))` },
  past_due: { label: "Payment failed", where: "plan_status = 'past_due'" },
  canceling: { label: "Cancelling", where: "plan_cancel_at IS NOT NULL AND plan_status IN ('active','trialing','past_due')" },
  comped: { label: "Free plan given", where: "plan_status = 'comped'" },
  suspended: { label: "Suspended", where: "suspended_at IS NOT NULL" },
} as const;
export type Segment = keyof typeof SEGMENTS;

export interface AdminUserRow {
  id: number;
  email: string;
  created_at: string;
  last_seen_at: string | null;
  plan: string;
  plan_status: string | null;
  plan_cancel_at: string | null;
  suspended_at: string | null;
  projects: number;
  conversations: number;
}

export const PAGE_SIZE = 50;

export const SORTS = {
  newest: { label: "Newest", order: "u.id DESC" },
  oldest: { label: "Oldest", order: "u.id ASC" },
  active: { label: "Last active", order: "u.last_seen_at IS NULL, u.last_seen_at DESC" },
  inactive: { label: "Longest inactive", order: "u.last_seen_at IS NOT NULL, u.last_seen_at ASC" },
  usage: { label: "Most usage", order: "conversations DESC, u.id DESC" },
} as const;
export type Sort = keyof typeof SORTS;

export function listUsers(opts: { q?: string; segment?: Segment; page?: number; all?: boolean; sort?: Sort }): { rows: AdminUserRow[]; total: number } {
  const seg = SEGMENTS[opts.segment ?? "all"] ?? SEGMENTS.all;
  const q = (opts.q ?? "").trim().toLowerCase();
  const where = `${seg.where}${q ? " AND email LIKE ? ESCAPE '\\'" : ""}`;
  const args: (string | number)[] = q ? [`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`] : [];
  const total = n(`SELECT COUNT(*) AS n FROM users WHERE ${where}`, ...args);
  const page = Math.max(1, opts.page ?? 1);
  const limit = opts.all ? "" : ` LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const rows = all<AdminUserRow>(
    `SELECT u.id, u.email, u.created_at, u.last_seen_at, u.plan, u.plan_status, u.plan_cancel_at, u.suspended_at,
       (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
       (SELECT COUNT(DISTINCT i.audit_id || ':' || i.conversation_id) FROM audit_items i
          JOIN audits a ON a.id = i.audit_id JOIN projects p ON p.id = a.project_id
          WHERE p.user_id = u.id AND COALESCE(i.created_at, a.created_at) >= ?) AS conversations
     FROM users u WHERE ${where} ORDER BY ${(SORTS[opts.sort ?? "newest"] ?? SORTS.newest).order}${limit}`,
    month, ...args,
  );
  return { rows, total };
}

export interface AdminUserDetail {
  user: AdminUserRow & { admin_note: string | null; paddle_customer_id: string | null; paddle_subscription_id: string | null; plan_renews_at: string | null; trial_ends_at: string | null };
  billing: ReturnType<typeof billingState>;
  usage: ReturnType<typeof usage>;
  sessions: number;
  projects: { id: number; name: string; created_at: string; kb: number; audits: number; conversations: number; agentRuns: number; workflows: number; bots: number; openIncidents: number }[];
  log: { admin_email: string; action: string; detail: string | null; created_at: string }[];
}

export function userDetail(id: number): AdminUserDetail | null {
  const user = get<AdminUserDetail["user"]>(
    `SELECT id, email, created_at, last_seen_at, plan, plan_status, plan_cancel_at, suspended_at, admin_note,
       paddle_customer_id, paddle_subscription_id, plan_renews_at, trial_ends_at, 0 AS projects, 0 AS conversations
     FROM users WHERE id = ?`, id,
  );
  if (!user) return null;
  const billing = billingState(id);
  const projects = all<{ id: number; name: string; created_at: string }>("SELECT id, name, created_at FROM projects WHERE user_id = ? ORDER BY id", id).map((p) => ({
    ...p,
    kb: n("SELECT COUNT(*) AS n FROM kb_docs WHERE project_id = ?", p.id),
    audits: n("SELECT COUNT(*) AS n FROM audits WHERE project_id = ?", p.id),
    conversations: n("SELECT COUNT(DISTINCT i.audit_id || ':' || i.conversation_id) AS n FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ?", p.id),
    agentRuns: n("SELECT COUNT(*) AS n FROM agent_runs WHERE project_id = ?", p.id),
    workflows: n("SELECT COUNT(*) AS n FROM workflow_sources WHERE project_id = ?", p.id),
    bots: n("SELECT COUNT(*) AS n FROM bot_targets WHERE project_id = ?", p.id),
    openIncidents: n("SELECT COUNT(*) AS n FROM incidents WHERE project_id = ? AND resolved = 0", p.id),
  }));
  return {
    user,
    billing,
    usage: usage(id, billing.plan),
    sessions: n("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?", id, new Date().toISOString()),
    projects,
    log: all("SELECT admin_email, action, detail, created_at FROM admin_log WHERE target_email = ? ORDER BY id DESC LIMIT 20", user.email),
  };
}

export function recentAdminLog(limit = 15): { admin_email: string; action: string; target_email: string | null; detail: string | null; created_at: string }[] {
  return all("SELECT admin_email, action, target_email, detail, created_at FROM admin_log ORDER BY id DESC LIMIT ?", limit);
}

/** Gives a user a plan without payment ("comped"), or takes it back to free. Paddle billing is not touched. */
export function setPlanManually(userId: number, plan: PlanId): void {
  if (plan === "free") run("UPDATE users SET plan = 'free', plan_status = NULL, plan_cancel_at = NULL, trial_ends_at = NULL, comp_ends_at = NULL WHERE id = ?", userId);
  else run("UPDATE users SET plan = ?, plan_status = 'comped', plan_cancel_at = NULL, trial_ends_at = NULL, comp_ends_at = NULL WHERE id = ?", plan, userId);
}

export function setSuspended(userId: number, suspended: boolean): void {
  run("UPDATE users SET suspended_at = ? WHERE id = ?", suspended ? new Date().toISOString() : null, userId);
  if (suspended) run("DELETE FROM sessions WHERE user_id = ?", userId);
}
