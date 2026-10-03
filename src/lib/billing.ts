import { createHmac, timingSafeEqual } from "node:crypto";
import { all, get, run } from "./db";
import { trackEvent, userGaIds } from "./ga";

/**
 * Plans, usage limits and Paddle billing (Paddle is the Merchant of Record).
 * Billing is switched on only when Paddle is configured; without it every account is unlimited (self-hosting, tests).
 */

export type PlanId = "free" | "starter" | "growth" | "agency" | "compliance";
export type Resource = "projects" | "conversations" | "bots" | "monitors" | "uptime" | "seats";

export interface Plan {
  id: PlanId | "unlimited";
  name: string;
  price: number;
  projects: number;
  conversations: number; // per calendar month
  bots: number; // chatbots with nightly tests
  monitors: number; // n8n/Make connections + AI agents
  uptime: number; // uptime monitors (URLs checked every few minutes)
  seats: number; // team members invited to the owner's projects (owner not counted)
}

const INF = Number.POSITIVE_INFINITY;

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", price: 0, projects: 1, conversations: 50, bots: 1, monitors: 2, uptime: 1, seats: 0 },
  starter: { id: "starter", name: "Starter", price: 29, projects: 1, conversations: 500, bots: 1, monitors: 5, uptime: 3, seats: 1 },
  growth: { id: "growth", name: "Growth", price: 79, projects: 3, conversations: 3000, bots: 5, monitors: INF, uptime: 10, seats: 5 },
  agency: { id: "agency", name: "Agency", price: 199, projects: 20, conversations: 15000, bots: 25, monitors: INF, uptime: 50, seats: 20 },
  compliance: { id: "compliance", name: "Compliance", price: 249, projects: 10, conversations: 10000, bots: 25, monitors: INF, uptime: 50, seats: 10 },
};
export const PAID_PLANS: PlanId[] = ["starter", "growth", "agency", "compliance"];

/** Marketing copy for the paid plans, shared by the pricing section and the billing page. */
export const PLAN_FEATURES: Record<Exclude<PlanId, "free">, string[]> = {
  starter: ["1 project", "500 audited conversations / month", "Nightly tests for 1 bot", "5 workflows or agents", "3 uptime monitors · 1 teammate", "Email + Slack alerts"],
  growth: ["3 projects", "3,000 audited conversations / month", "Nightly tests for 5 bots", "Unlimited workflows and agents", "10 uptime monitors · 5 teammates", "Neural risk model + training export"],
  agency: ["20 client projects", "15,000 audited conversations / month", "White-label client reports (share link + PDF)", "50 uptime monitors · 20 teammates", "Priority support", "Everything in Growth"],
  compliance: ["For dealers, finance, insurance & healthcare", "10 projects · 10,000 conversations / month", "Signed DPA, results-only storage, auto-delete", "AI-off mode or self-hosted option", "Risk reports + onboarding call + priority support"],
};

/** Optional plans are sold only when their Paddle price is configured; otherwise shown as "Talk to us". */
export const OPTIONAL_PLANS: PlanId[] = ["compliance"];
const UNLIMITED: Plan = { id: "unlimited", name: "Unlimited", price: 0, projects: INF, conversations: INF, bots: INF, monitors: INF, uptime: INF, seats: INF };

/** States that keep the paid plan active. past_due keeps access while Paddle retries; comped is a free plan given by an admin. */
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due", "comped"]);
/** Subscription states that actually bring in money (trials and free upgrades do not). */
export const ACTIVE_STATUSES_FOR_REVENUE = new Set(["active", "past_due"]);

// ---------- Configuration ----------

export function paddleEnv(): "sandbox" | "production" {
  return process.env.PADDLE_ENV?.trim() === "production" ? "production" : "sandbox";
}

export function priceId(plan: PlanId): string {
  return (process.env[`PADDLE_PRICE_${plan.toUpperCase()}`] ?? "").trim();
}

export function planForPrice(price: string | undefined): PlanId | null {
  if (!price) return null;
  return PAID_PLANS.find((p) => priceId(p) === price) ?? null;
}

export function billingEnabled(): boolean {
  return Boolean(process.env.PADDLE_API_KEY?.trim() && process.env.PADDLE_CLIENT_TOKEN?.trim() && PAID_PLANS.some((p) => priceId(p)));
}

/** Human-readable setup mistakes (placeholder text, sandbox/live mix-ups) shown on the billing page. */
export function billingConfigProblems(): string[] {
  const out: string[] = [];
  const env = paddleEnv();
  const key = process.env.PADDLE_API_KEY?.trim() ?? "";
  const token = process.env.PADDLE_CLIENT_TOKEN?.trim() ?? "";
  if (/\s/.test(key) || (key && !key.startsWith("pdl_"))) out.push("PADDLE_API_KEY does not look like a Paddle API key (it starts with pdl_).");
  if (key.startsWith("pdl_live_") && env === "sandbox") out.push("PADDLE_API_KEY is a live key but PADDLE_ENV is sandbox.");
  if (key.startsWith("pdl_sdbx_") && env === "production") out.push("PADDLE_API_KEY is a sandbox key but PADDLE_ENV is production.");
  if (token && !/^(test|live)_\w+$/.test(token)) out.push("PADDLE_CLIENT_TOKEN does not look like a client-side token (it starts with test_ or live_).");
  if (token.startsWith("live_") && env === "sandbox") out.push("PADDLE_CLIENT_TOKEN is a live token but PADDLE_ENV is sandbox.");
  if (token.startsWith("test_") && env === "production") out.push("PADDLE_CLIENT_TOKEN is a sandbox token but PADDLE_ENV is production.");
  for (const p of PAID_PLANS) {
    const id = priceId(p);
    if (!id && OPTIONAL_PLANS.includes(p)) continue; // optional plan shown as "Talk to us"
    if (!id) out.push(`PADDLE_PRICE_${p.toUpperCase()} is missing.`);
    else if (!/^pri_\w+$/.test(id)) out.push(`PADDLE_PRICE_${p.toUpperCase()} should be a price ID starting with pri_ (not the product ID pro_).`);
  }
  if (!process.env.PADDLE_WEBHOOK_SECRET?.trim()) out.push("PADDLE_WEBHOOK_SECRET is missing, so plan changes made in Paddle will not sync automatically.");
  return out;
}

// ---------- Plans and usage ----------

export interface BillingState {
  plan: Plan;
  status: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  renewsAt: string | null;
  cancelAt: string | null;
  trialEndsAt: string | null;
}

function unlimitedEmail(email: string): boolean {
  return (process.env.UNLIMITED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

export function billingState(userId: number): BillingState {
  const u = get<{ email: string; plan: string; plan_status: string | null; paddle_customer_id: string | null; paddle_subscription_id: string | null; plan_renews_at: string | null; plan_cancel_at: string | null; trial_ends_at: string | null }>(
    "SELECT email, plan, plan_status, paddle_customer_id, paddle_subscription_id, plan_renews_at, plan_cancel_at, trial_ends_at FROM users WHERE id = ?", userId,
  );
  const paid = u && ACTIVE_STATUSES.has(u.plan_status ?? "") && u.plan in PLANS ? PLANS[u.plan as PlanId] : PLANS.free;
  const plan = !billingEnabled() || (u && unlimitedEmail(u.email)) ? UNLIMITED : paid;
  return {
    plan,
    status: u?.plan_status ?? null,
    customerId: u?.paddle_customer_id ?? null,
    subscriptionId: u?.paddle_subscription_id ?? null,
    renewsAt: u?.plan_renews_at ?? null,
    cancelAt: u?.plan_cancel_at ?? null,
    trialEndsAt: u?.trial_ends_at ?? null,
  };
}

function monthStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function usage(userId: number, plan: Plan): Record<Resource, number> {
  const since = monthStart();
  const n = (sql: string, ...args: (string | number)[]) => get<{ n: number }>(sql, ...args)?.n ?? 0;
  const agents = all<{ agent_name: string }>(
    "SELECT DISTINCT r.agent_name FROM agent_runs r JOIN projects p ON p.id = r.project_id WHERE p.user_id = ?", userId,
  ).length;
  return {
    projects: n("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?", userId),
    conversations: n(
      `SELECT COUNT(DISTINCT i.audit_id || ':' || i.conversation_id) AS n FROM audit_items i
       JOIN audits a ON a.id = i.audit_id JOIN projects p ON p.id = a.project_id
       WHERE p.user_id = ? AND COALESCE(i.created_at, a.created_at) >= ?`, userId, since,
    ),
    bots: n("SELECT COUNT(*) AS n FROM bot_targets b JOIN projects p ON p.id = b.project_id WHERE p.user_id = ?", userId),
    monitors: agents + n("SELECT COUNT(*) AS n FROM workflow_sources w JOIN projects p ON p.id = w.project_id WHERE p.user_id = ?", userId),
    uptime: n("SELECT COUNT(*) AS n FROM uptime_monitors m JOIN projects p ON p.id = m.project_id WHERE p.user_id = ?", userId),
    seats: n(
      `SELECT COUNT(*) AS n FROM (SELECT u.email FROM project_members pm JOIN projects p ON p.id = pm.project_id JOIN users u ON u.id = pm.user_id WHERE p.user_id = ?
         UNION SELECT i.email FROM project_invites i JOIN projects p ON p.id = i.project_id WHERE p.user_id = ? AND i.accepted_at IS NULL AND i.expires_at > datetime('now'))`,
      userId, userId,
    ),
  };
}

const LABELS: Record<Resource, string> = {
  projects: "project(s)",
  conversations: "audited conversations",
  bots: "chatbot(s) with nightly tests",
  monitors: "workflows and AI agents",
  uptime: "uptime monitor(s)",
  seats: "team member(s)",
};

/** Returns an error message when adding `adding` more of a resource would exceed the user's plan, otherwise null. */
export function limitError(userId: number, resource: Resource, adding = 1): string | null {
  const { plan } = billingState(userId);
  const limit = plan[resource];
  if (!Number.isFinite(limit)) return null;
  const used = usage(userId, plan)[resource];
  if (used + adding <= limit) return null;
  const period = resource === "conversations" ? " per month" : "";
  const left = Math.max(0, limit - used);
  const extra = resource === "conversations" && left > 0 ? ` You have ${left} left.` : "";
  return `Your ${plan.name} plan includes ${limit} ${LABELS[resource]}${period}.${extra} Upgrade on the Billing page to add more.`;
}

/** Owner user of a project, for API requests that only know the project. */
export function projectOwner(projectId: number): number {
  return get<{ user_id: number }>("SELECT user_id FROM projects WHERE id = ?", projectId)?.user_id ?? 0;
}

// ---------- Paddle ----------

/** Signs the user ID we pass to checkout so a subscription can't be attached to someone else's account. */
export function checkoutSignature(userId: number): string {
  return createHmac("sha256", process.env.APP_SECRET || "dev-secret").update(`paddle-user:${userId}`).digest("hex").slice(0, 32);
}

function signedUserId(custom: unknown): number | null {
  const c = custom as { user_id?: unknown; sig?: unknown } | null;
  const id = Number(c?.user_id);
  if (!Number.isInteger(id) || id <= 0 || typeof c?.sig !== "string") return null;
  const a = Buffer.from(c.sig);
  const b = Buffer.from(checkoutSignature(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** Verifies the Paddle-Signature header ("ts=...;h1=...") over the raw body. */
export function verifyWebhook(rawBody: string, header: string | null, secret: string, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = header.split(";").map((p) => p.trim().split("=", 2));
  const ts = Number(parts.find(([k]) => k === "ts")?.[1]);
  const signatures = parts.filter(([k, v]) => k === "h1" && v).map(([, v]) => v);
  if (!Number.isFinite(ts) || !signatures.length || Math.abs(nowMs / 1000 - ts) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex"));
  // Paddle may send several h1 values while a secret is being rotated; any match is valid.
  return signatures.some((sig) => {
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export interface PaddleSubscription {
  id: string;
  status: string;
  customer_id: string;
  custom_data?: unknown;
  items?: { price?: { id?: string }; trial_dates?: { ends_at?: string } | null }[];
  next_billed_at?: string | null;
  scheduled_change?: { action?: string; effective_at?: string } | null;
  updated_at?: string;
}

/** Stores a subscription's state on its user. Returns the user ID, or null when the subscription can't be matched. */
export function applySubscription(sub: PaddleSubscription): number | null {
  const userId =
    signedUserId(sub.custom_data) ??
    get<{ id: number }>("SELECT id FROM users WHERE paddle_subscription_id = ?", sub.id)?.id ??
    get<{ id: number }>("SELECT id FROM users WHERE paddle_customer_id = ?", sub.customer_id)?.id ??
    null;
  if (!userId) return null;
  const current = get<{ paddle_subscription_id: string | null; plan_status: string | null; plan_updated_at: string | null }>(
    "SELECT paddle_subscription_id, plan_status, plan_updated_at FROM users WHERE id = ?", userId,
  )!;
  // An older subscription ending must not cancel the plan of a newer, still-active one.
  if (current.paddle_subscription_id && current.paddle_subscription_id !== sub.id && !ACTIVE_STATUSES.has(sub.status) && ACTIVE_STATUSES.has(current.plan_status ?? "")) {
    return userId;
  }
  // Webhooks can arrive out of order: ignore anything older than what we already stored.
  if (current.paddle_subscription_id === sub.id && current.plan_updated_at && sub.updated_at && sub.updated_at < current.plan_updated_at) return userId;
  const plan = planForPrice(sub.items?.[0]?.price?.id);
  run(
    `UPDATE users SET plan = ?, plan_status = ?, paddle_customer_id = ?, paddle_subscription_id = ?, plan_renews_at = ?,
       plan_cancel_at = ?, trial_ends_at = ?, plan_updated_at = ? WHERE id = ?`,
    plan ?? "free",
    sub.status,
    sub.customer_id,
    sub.id,
    sub.next_billed_at ?? null,
    sub.scheduled_change?.action === "cancel" ? sub.scheduled_change.effective_at ?? null : null,
    sub.status === "trialing" ? sub.items?.[0]?.trial_dates?.ends_at ?? null : null,
    sub.updated_at ?? new Date().toISOString(),
    userId,
  );
  // Conversions for Google Analytics, once per transition (the webhook and the checkout sync may both arrive).
  const same = current.paddle_subscription_id === sub.id;
  const price = plan ? PLANS[plan].price : 0;
  if (sub.status === "trialing" && !(same && current.plan_status === "trialing")) {
    void trackEvent(userGaIds(userId), "begin_trial", { plan: plan ?? "unknown", value: price, currency: "USD" });
  }
  if (sub.status === "active" && !(same && ["active", "past_due"].includes(current.plan_status ?? ""))) {
    void trackEvent(userGaIds(userId), "purchase", { transaction_id: `${sub.id}:${sub.next_billed_at ?? ""}`, value: price, currency: "USD", plan: plan ?? "unknown" });
  }
  return userId;
}

async function paddleApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const base = paddleEnv() === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY?.trim()}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json().catch(() => ({}))) as { data?: T; error?: { detail?: string; code?: string } };
  if (!res.ok || !data.data) throw new Error(`Paddle: ${data.error?.detail ?? data.error?.code ?? `HTTP ${res.status}`}`);
  return data.data;
}

/** Pulls the subscription created by a just-finished checkout, so the plan updates even before the webhook arrives. */
export async function syncTransaction(userId: number, transactionId: string): Promise<boolean> {
  if (!/^txn_\w+$/.test(transactionId)) return false;
  const txn = await paddleApi<{ custom_data?: unknown; subscription_id?: string | null }>(`/transactions/${transactionId}`);
  if (signedUserId(txn.custom_data) !== userId || !txn.subscription_id) return false;
  return applySubscription(await paddleApi<PaddleSubscription>(`/subscriptions/${txn.subscription_id}`)) === userId;
}

/** Switches an existing subscription to another plan (prorated; free while trialing). */
export async function changePlan(userId: number, plan: PlanId): Promise<void> {
  const state = billingState(userId);
  const price = priceId(plan);
  if (!state.subscriptionId || !price) throw new Error("No subscription to change.");
  const sub = await paddleApi<PaddleSubscription>(`/subscriptions/${state.subscriptionId}`, {
    method: "PATCH",
    body: {
      items: [{ price_id: price, quantity: 1 }],
      proration_billing_mode: state.status === "trialing" ? "do_not_bill" : "prorated_immediately",
    },
  });
  applySubscription(sub);
}

/**
 * Auto-renew on/off. Off = cancel at the end of the current period (or trial), so the customer keeps
 * access until then and is not charged again. On = remove that scheduled cancellation.
 */
export async function setAutoRenew(userId: number, on: boolean): Promise<void> {
  const state = billingState(userId);
  if (!state.subscriptionId || !["active", "trialing", "past_due"].includes(state.status ?? "")) throw new Error("You don't have an active subscription.");
  const sub = on
    ? await paddleApi<PaddleSubscription>(`/subscriptions/${state.subscriptionId}`, { method: "PATCH", body: { scheduled_change: null } })
    : await paddleApi<PaddleSubscription>(`/subscriptions/${state.subscriptionId}/cancel`, { method: "POST", body: { effective_from: "next_billing_period" } });
  applySubscription(sub);
}

/** One-time link to Paddle's customer portal (cancel, payment method, invoices). */
export async function portalUrl(userId: number): Promise<string> {
  const state = billingState(userId);
  if (!state.customerId) throw new Error("No billing account yet.");
  const session = await paddleApi<{ urls: { general: { overview: string } } }>(`/customers/${state.customerId}/portal-sessions`, {
    method: "POST",
    body: { subscription_ids: state.subscriptionId ? [state.subscriptionId] : [] },
  });
  return session.urls.general.overview;
}

/**
 * IDs of chatbot targets or workflow connections that scheduled jobs should still run: after a downgrade or an ended
 * trial, each account keeps its oldest items up to the plan limit. Returns null when every item may run.
 */
export function scheduledIds(kind: "bots" | "sources"): Set<number> | null {
  if (!billingEnabled()) return null;
  const table = kind === "bots" ? "bot_targets" : "workflow_sources";
  const rows = all<{ id: number; user_id: number }>(`SELECT x.id, p.user_id FROM ${table} x JOIN projects p ON p.id = x.project_id ORDER BY x.id`);
  const keep = new Set<number>();
  const used = new Map<number, number>();
  const limits = new Map<number, number>();
  for (const r of rows) {
    if (!limits.has(r.user_id)) {
      const plan = billingState(r.user_id).plan;
      // Agents share the monitor allowance with workflow connections, but they only run on the customer's side.
      limits.set(r.user_id, kind === "bots" ? plan.bots : plan.monitors);
    }
    const n = used.get(r.user_id) ?? 0;
    if (n < limits.get(r.user_id)!) keep.add(r.id);
    used.set(r.user_id, n + 1);
  }
  return keep;
}

/** Asks Paddle whether each configured price exists in this environment and is set up as a monthly subscription. */
export async function checkPaddlePrices(): Promise<string[]> {
  if (!billingEnabled()) return [];
  const where = paddleEnv() === "production" ? "live (vendors.paddle.com)" : "sandbox (sandbox-vendors.paddle.com)";
  const out: string[] = [];
  for (const plan of PAID_PLANS) {
    const id = priceId(plan);
    if (!/^pri_\w+$/.test(id)) continue;
    const name = `PADDLE_PRICE_${plan.toUpperCase()}`;
    try {
      const p = await paddleApi<{ status?: string; billing_cycle?: { interval?: string } | null; trial_period?: unknown; unit_price?: { amount?: string; currency_code?: string } }>(`/prices/${id}`);
      if (p.status !== "active") out.push(`${name}: this price is ${p.status ?? "not active"} in Paddle. Un-archive it or create a new one.`);
      if (!p.billing_cycle) out.push(`${name}: this price is one-time. Create a Recurring (monthly) price instead.`);
      if (!p.trial_period) out.push(`${name}: this price has no free trial. Edit it and set Trial period = 14 days.`);
      const dollars = Number(p.unit_price?.amount) / 100;
      if (p.unit_price && dollars !== PLANS[plan].price) out.push(`${name}: Paddle price is ${dollars} ${p.unit_price.currency_code}, the website shows $${PLANS[plan].price}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.startsWith("Paddle:")) return [`Could not reach Paddle to check your prices (${msg}). Reload this page to try again.`];
      if (/authenticat|unauthori|HTTP 401/i.test(msg)) return [`PADDLE_API_KEY was rejected by Paddle ${where}. Create a new API key in that account and paste it again.`];
      if (/forbidden|permission|HTTP 403/i.test(msg)) return [`PADDLE_API_KEY has no permission to read prices. In Paddle → Developer Tools → Authentication, give the key all permissions (or create a new one).`];
      out.push(`${name} (${id}) was not found in your ${where} account. Copy the price ID from that account's Catalog → Products.`);
    }
  }
  return out;
}
