import { ACTIVE_STATUSES_FOR_REVENUE, PLANS, type PlanId } from "./billing";
import { all, get, run } from "./db";

/**
 * AI cost tracking: every AI judge call records its token usage and dollar cost (never any customer
 * text), so the admin can see what each customer costs against what they pay.
 */

export type AiKind = "audit" | "live" | "test" | "agent";
export interface AiUse { projectId: number; kind: AiKind }
export interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

/** US$ per million tokens (Anthropic first-party prices). Cache writes cost 1.25× input. */
const ANTHROPIC_PRICES: [prefix: string, input: number, output: number, cacheRead: number][] = [
  ["claude-fable-5", 10, 50, 0.25],
  ["claude-mythos-5", 10, 50, 0.25],
  ["claude-opus-5-5", 4, 20, 0.2],
  ["claude-opus-5", 5, 25, 0.5],
  ["claude-opus-4", 5, 25, 0.5],
  ["claude-sonnet-5", 2, 10, 0.2],
  ["claude-sonnet-4", 3, 15, 0.3],
  ["claude-haiku-4", 1, 5, 0.1],
];

/** Dollar cost of one call, or null when the model's price is unknown. Free-tier Gemini costs nothing. */
export function callCost(provider: string, model: string, u: TokenUsage): number | null {
  if (provider === "gemini") return process.env.GEMINI_PAID_TIER === "1" ? null : 0;
  const p = ANTHROPIC_PRICES.find(([prefix]) => model.startsWith(prefix));
  if (!p) return null;
  const [, input, output, cacheRead] = p;
  return (u.input * input + u.cacheWrite * input * 1.25 + u.cacheRead * cacheRead + u.output * output) / 1_000_000;
}

/** Stores one AI call's usage. Never throws: cost tracking must not break grading. */
export function recordAiUsage(use: AiUse | undefined, provider: string, model: string, u: TokenUsage): void {
  try {
    const userId = use ? get<{ u: number }>("SELECT user_id AS u FROM projects WHERE id = ?", use.projectId)?.u ?? null : null;
    run(
      `INSERT INTO ai_usage (project_id, user_id, kind, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      use?.projectId ?? null, userId, use?.kind ?? "audit", provider, model,
      u.input, u.output, u.cacheRead, u.cacheWrite, callCost(provider, model, u),
    );
  } catch (err) {
    console.error("[ai-cost] could not record usage:", err instanceof Error ? err.message : err);
  }
}

export const monthStartIso = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;

export interface CustomerCost {
  userId: number;
  email: string;
  plan: PlanId;
  status: string | null;
  revenue: number;
  cost: number;
  calls: number;
  unpriced: number;
  /** AI cost as a share of revenue (null when they pay nothing). */
  share: number | null;
  flag: "ok" | "watch" | "loss";
}

/** Revenue this customer brings per month (paying subscriptions only; trials and free upgrades bring $0). */
export function monthlyRevenue(plan: string, status: string | null): number {
  return ACTIVE_STATUSES_FOR_REVENUE.has(status ?? "") && plan in PLANS ? PLANS[plan as PlanId].price : 0;
}

export function customerCosts(since = monthStartIso(), until = "9999"): CustomerCost[] {
  const rows = all<{ user_id: number; email: string; plan: string; plan_status: string | null; cost: number | null; calls: number; unpriced: number }>(
    `SELECT a.user_id, u.email, u.plan, u.plan_status, SUM(a.cost_usd) AS cost, COUNT(*) AS calls, SUM(a.cost_usd IS NULL) AS unpriced
       FROM ai_usage a JOIN users u ON u.id = a.user_id
      WHERE a.created_at >= ? AND a.created_at < ? GROUP BY a.user_id ORDER BY cost DESC`, since, until,
  );
  return rows.map((r) => {
    const revenue = monthlyRevenue(r.plan, r.plan_status);
    const cost = r.cost ?? 0;
    const share = revenue > 0 ? cost / revenue : null;
    // Paying customers: loss when AI alone costs more than they pay, watch above 50%. Non-paying: watch above $5.
    const flag = share !== null ? (share >= 1 ? "loss" : share >= 0.5 ? "watch" : "ok") : cost >= 5 ? "watch" : "ok";
    return { userId: r.user_id, email: r.email, plan: r.plan as PlanId, status: r.plan_status, revenue, cost, calls: r.calls, unpriced: r.unpriced, share, flag };
  });
}

export interface CostSummary {
  cost: number;
  calls: number;
  byKind: Record<AiKind, { cost: number; calls: number }>;
  byModel: { model: string; cost: number; calls: number }[];
  perConversation: number | null;
  revenue: number;
  daily: { day: string; cost: number }[];
}

export function costSummary(since = monthStartIso(), until = "9999"): CostSummary {
  const kinds = all<{ kind: AiKind; cost: number | null; calls: number }>(
    "SELECT kind, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM ai_usage WHERE created_at >= ? AND created_at < ? GROUP BY kind", since, until,
  );
  const byKind = { audit: { cost: 0, calls: 0 }, live: { cost: 0, calls: 0 }, test: { cost: 0, calls: 0 }, agent: { cost: 0, calls: 0 } } as CostSummary["byKind"];
  for (const k of kinds) if (k.kind in byKind) byKind[k.kind] = { cost: k.cost ?? 0, calls: k.calls };
  const cost = Object.values(byKind).reduce((s, k) => s + k.cost, 0);
  const calls = Object.values(byKind).reduce((s, k) => s + k.calls, 0);
  const convCalls = byKind.audit.calls + byKind.live.calls;
  const revenue = all<{ plan: string; plan_status: string | null }>("SELECT plan, plan_status FROM users WHERE suspended_at IS NULL")
    .reduce((s, u) => s + monthlyRevenue(u.plan, u.plan_status), 0);
  return {
    cost, calls, byKind, revenue,
    byModel: all<{ model: string; cost: number | null; calls: number }>(
      "SELECT model, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM ai_usage WHERE created_at >= ? AND created_at < ? GROUP BY model ORDER BY cost DESC", since, until,
    ).map((m) => ({ model: m.model, cost: m.cost ?? 0, calls: m.calls })),
    perConversation: convCalls ? (byKind.audit.cost + byKind.live.cost) / convCalls : null,
    daily: all<{ day: string; cost: number | null }>(
      "SELECT substr(created_at, 1, 10) AS day, SUM(cost_usd) AS cost FROM ai_usage WHERE created_at >= ? AND created_at < ? GROUP BY day ORDER BY day", since, until,
    ).map((d) => ({ day: d.day, cost: d.cost ?? 0 })),
  };
}

/** One customer's AI cost this month (for the admin user page). */
export function userMonthCost(userId: number, since = monthStartIso()): { cost: number; calls: number } {
  const r = get<{ cost: number | null; calls: number }>("SELECT SUM(cost_usd) AS cost, COUNT(*) AS calls FROM ai_usage WHERE user_id = ? AND created_at >= ?", userId, since);
  return { cost: r?.cost ?? 0, calls: r?.calls ?? 0 };
}
