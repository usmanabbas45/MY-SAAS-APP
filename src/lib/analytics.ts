import { costSummary } from "./aicost";
import { PLANS, type PlanId } from "./billing";
import { all, get, run } from "./db";

/** Advanced business analytics for the admin: funnel, retention, adoption, revenue and history. */

const n = (sql: string, ...args: (string | number)[]) => get<{ n: number }>(sql, ...args)?.n ?? 0;
const day = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (k: number, now = new Date()) => new Date(now.getTime() - k * 86400000);

/** SQL conditions per user (alias u) for each step and feature. */
const HAS = {
  data: `EXISTS (SELECT 1 FROM projects p WHERE p.user_id = u.id AND (
            EXISTS (SELECT 1 FROM kb_docs k WHERE k.project_id = p.id) OR EXISTS (SELECT 1 FROM audits a WHERE a.project_id = p.id)
         OR EXISTS (SELECT 1 FROM bot_targets b WHERE b.project_id = p.id) OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.project_id = p.id)
         OR EXISTS (SELECT 1 FROM workflow_sources w WHERE w.project_id = p.id) OR EXISTS (SELECT 1 FROM workflow_runs w WHERE w.project_id = p.id)))`,
  results: `EXISTS (SELECT 1 FROM projects p WHERE p.user_id = u.id AND (
            EXISTS (SELECT 1 FROM audits a JOIN audit_items i ON i.audit_id = a.id WHERE a.project_id = p.id)
         OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.project_id = p.id) OR EXISTS (SELECT 1 FROM workflow_runs w WHERE w.project_id = p.id)
         OR EXISTS (SELECT 1 FROM test_runs t JOIN bot_targets b ON b.id = t.target_id WHERE b.project_id = p.id)))`,
  trial: "(u.trial_ends_at IS NOT NULL OR u.paddle_subscription_id IS NOT NULL)",
  paying: "u.plan_status IN ('active','past_due') AND u.plan <> 'free'",
};

export interface FunnelStep { label: string; hint: string; count: number }

export function funnel(sinceDays: number | null): FunnelStep[] {
  const since = sinceDays === null ? "0000" : day(daysAgo(sinceDays));
  const c = (cond: string) => n(`SELECT COUNT(*) AS n FROM users u WHERE u.created_at >= ? AND ${cond}`, since);
  return [
    { label: "Signed up", hint: "created an account", count: c("1=1") },
    { label: "Connected data", hint: "added articles, uploaded chats, or connected a bot, agent or workflow", count: c(HAS.data) },
    { label: "Saw results", hint: "has checked answers, agent runs, workflow runs or test results", count: c(HAS.results) },
    { label: "Started trial or paid", hint: "opened a Paddle checkout successfully", count: c(HAS.trial) },
    { label: "Paying now", hint: "active subscription", count: c(HAS.paying) },
  ];
}

/** Sign-ups, activation, paying customers and leads per marketing channel ("which marketing works"). */
export interface ChannelRow { channel: string; signups: number; connected: number; paying: number; leads: number }

export function channels(sinceDays: number | null): ChannelRow[] {
  const since = sinceDays === null ? "0000" : day(daysAgo(sinceDays));
  const users = all<{ channel: string; signups: number; connected: number; paying: number }>(
    `SELECT COALESCE(u.signup_channel, 'Direct / unknown') AS channel, COUNT(*) AS signups,
            SUM(CASE WHEN ${HAS.data} THEN 1 ELSE 0 END) AS connected, SUM(CASE WHEN ${HAS.paying} THEN 1 ELSE 0 END) AS paying
     FROM users u WHERE u.created_at >= ? GROUP BY 1`, since);
  const leads = all<{ channel: string; n: number }>("SELECT COALESCE(channel, 'Direct / unknown') AS channel, COUNT(*) AS n FROM leads WHERE created_at >= ? GROUP BY 1", since);
  const map = new Map<string, ChannelRow>();
  for (const u of users) map.set(u.channel, { ...u, leads: 0 });
  for (const l of leads) {
    const row = map.get(l.channel) ?? { channel: l.channel, signups: 0, connected: 0, paying: 0, leads: 0 };
    row.leads = l.n;
    map.set(l.channel, row);
  }
  return [...map.values()].sort((a, b) => b.paying - a.paying || b.signups - a.signups || b.leads - a.leads);
}

export interface Cohort { week: string; size: number; weeks: (number | null)[] }

/** Monday (UTC) of the week containing d. */
function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/** Weekly sign-up cohorts: share of each cohort active in week 0, 1, 2… after sign-up. */
export function retention(weeksBack = 8, now = new Date()): Cohort[] {
  const thisWeek = weekStart(now);
  const first = new Date(thisWeek.getTime() - (weeksBack - 1) * 7 * 86400000);
  const users = all<{ id: number; created_at: string }>("SELECT id, created_at FROM users WHERE created_at >= ?", day(first));
  const acts = all<{ user_id: number; day: string }>("SELECT user_id, day FROM user_activity WHERE day >= ?", day(first));
  const activeWeeks = new Map<number, Set<number>>();
  for (const a of acts) {
    const w = Math.floor((weekStart(new Date(`${a.day}T00:00:00Z`)).getTime() - first.getTime()) / (7 * 86400000));
    if (!activeWeeks.has(a.user_id)) activeWeeks.set(a.user_id, new Set());
    activeWeeks.get(a.user_id)!.add(w);
  }
  return Array.from({ length: weeksBack }, (_, i) => {
    const start = new Date(first.getTime() + i * 7 * 86400000);
    const cohort = users.filter((u) => weekStart(new Date(`${u.created_at.slice(0, 10)}T00:00:00Z`)).getTime() === start.getTime());
    const weeks = Array.from({ length: weeksBack }, (_, k) => {
      if (i + k >= weeksBack) return null; // that week hasn't happened yet
      if (!cohort.length) return null;
      return cohort.filter((u) => activeWeeks.get(u.id)?.has(i + k)).length / cohort.length;
    });
    return { week: day(start), size: cohort.length, weeks };
  });
}

export interface Adoption { feature: string; users: number; share: number }

export function adoption(): Adoption[] {
  const total = Math.max(1, n("SELECT COUNT(*) AS n FROM users"));
  const f = (feature: string, sql: string): Adoption => {
    const users = n(`SELECT COUNT(DISTINCT p.user_id) AS n FROM projects p WHERE ${sql}`);
    return { feature, users, share: users / total };
  };
  return [
    f("📚 Knowledge base articles", "EXISTS (SELECT 1 FROM kb_docs k WHERE k.project_id = p.id)"),
    f("💬 Chatbot audits (uploads)", "EXISTS (SELECT 1 FROM audits a WHERE a.project_id = p.id AND a.status <> 'live')"),
    f("📡 Live tracking", "EXISTS (SELECT 1 FROM audits a WHERE a.project_id = p.id AND a.status = 'live')"),
    f("🧪 Nightly bot tests", "EXISTS (SELECT 1 FROM bot_targets b WHERE b.project_id = p.id)"),
    f("🤖 AI agent monitoring", "EXISTS (SELECT 1 FROM agent_runs r WHERE r.project_id = p.id)"),
    f("⚙️ n8n / Make", "EXISTS (SELECT 1 FROM workflow_sources w WHERE w.project_id = p.id) OR EXISTS (SELECT 1 FROM workflow_runs w WHERE w.project_id = p.id)"),
    f("🔔 Alert channels", "EXISTS (SELECT 1 FROM alert_channels c WHERE c.project_id = p.id) OR p.alert_email IS NOT NULL OR p.alert_webhook IS NOT NULL"),
    f("📏 Custom rules", "EXISTS (SELECT 1 FROM rules r WHERE r.project_id = p.id)"),
    f("📄 Shared client reports", "EXISTS (SELECT 1 FROM audits a WHERE a.project_id = p.id AND a.share_token IS NOT NULL)"),
  ].sort((a, b) => b.users - a.users);
}

export interface Revenue {
  mrr: number;
  arr: number;
  paying: number;
  arpu: number;
  trialsEnded: number;
  trialConverted: number;
  trialConversion: number | null;
  churned30: number;
  churnRate: number | null;
  aiCost: number;
  grossMargin: number | null;
  byPlan: { plan: PlanId; name: string; paying: number; mrr: number }[];
}

export function revenue(now = new Date()): Revenue {
  const byPlan = (["starter", "growth", "agency", "compliance"] as PlanId[]).map((plan) => {
    const paying = n("SELECT COUNT(*) AS n FROM users WHERE plan = ? AND plan_status IN ('active','past_due')", plan);
    return { plan, name: PLANS[plan].name, paying, mrr: paying * PLANS[plan].price };
  });
  const mrr = byPlan.reduce((s, p) => s + p.mrr, 0);
  const paying = byPlan.reduce((s, p) => s + p.paying, 0);
  const iso = now.toISOString();
  const trialsEnded = n("SELECT COUNT(*) AS n FROM users WHERE trial_ends_at IS NOT NULL AND trial_ends_at < ?", iso);
  const trialConverted = n("SELECT COUNT(*) AS n FROM users WHERE trial_ends_at IS NOT NULL AND trial_ends_at < ? AND plan_status IN ('active','past_due')", iso);
  const churned30 = n("SELECT COUNT(*) AS n FROM users WHERE plan_status = 'canceled' AND COALESCE(plan_updated_at, '') >= ?", daysAgo(30, now).toISOString());
  const aiCost = costSummary().cost;
  return {
    mrr, arr: mrr * 12, paying, arpu: paying ? mrr / paying : 0,
    trialsEnded, trialConverted, trialConversion: trialsEnded ? trialConverted / trialsEnded : null,
    churned30, churnRate: paying + churned30 ? churned30 / (paying + churned30) : null,
    aiCost, grossMargin: mrr ? (mrr - aiCost) / mrr : null,
    byPlan,
  };
}

/** Saves today's snapshot (users, paying, trials, MRR, AI cost). Safe to call often. */
export function recordDailyMetrics(now = new Date()): void {
  const r = revenue(now);
  run(
    `INSERT INTO metrics_daily (day, users, paying, trialing, mrr, ai_cost) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET users = excluded.users, paying = excluded.paying, trialing = excluded.trialing, mrr = excluded.mrr, ai_cost = excluded.ai_cost`,
    day(now), n("SELECT COUNT(*) AS n FROM users"), r.paying,
    n("SELECT COUNT(*) AS n FROM users WHERE plan_status = 'trialing' AND plan <> 'free'"), r.mrr, r.aiCost,
  );
}

export function metricsHistory(days = 90): { day: string; users: number; paying: number; trialing: number; mrr: number }[] {
  return all("SELECT day, users, paying, trialing, mrr FROM metrics_daily WHERE day >= ? ORDER BY day", day(daysAgo(days)));
}

export function signupsByDay(days = 90): { day: string; count: number }[] {
  const rows = all<{ day: string; count: number }>("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM users WHERE created_at >= ? GROUP BY day", day(daysAgo(days - 1)));
  return Array.from({ length: days }, (_, i) => {
    const d = day(daysAgo(days - 1 - i));
    return { day: d, count: rows.find((r) => r.day === d)?.count ?? 0 };
  });
}

export interface AtRisk { id: number; email: string; plan: string; last_seen_at: string | null; reason: string }

/** Paying or trialing customers who look likely to leave. */
export function atRiskCustomers(now = new Date()): AtRisk[] {
  const stale = daysAgo(14, now).toISOString();
  return all<AtRisk>(
    `SELECT id, email, plan, last_seen_at,
       CASE WHEN plan_status = 'past_due' THEN 'Payment failed'
            WHEN plan_cancel_at IS NOT NULL THEN 'Cancelling'
            ELSE 'Not seen for 14+ days' END AS reason
       FROM users
      WHERE plan <> 'free' AND plan_status IN ('active','trialing','past_due')
        AND (plan_status = 'past_due' OR plan_cancel_at IS NOT NULL OR last_seen_at IS NULL OR last_seen_at < ?)
      ORDER BY last_seen_at LIMIT 50`, stale,
  );
}

export function topCustomers(limit = 10): { id: number; email: string; plan: string; conversations: number; runs: number }[] {
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  return all<{ id: number; email: string; plan: string; conversations: number; runs: number }>(
    `SELECT u.id, u.email, u.plan,
       (SELECT COUNT(DISTINCT i.audit_id || ':' || i.conversation_id) FROM audit_items i JOIN audits a ON a.id = i.audit_id JOIN projects p ON p.id = a.project_id
         WHERE p.user_id = u.id AND i.created_at >= ?) AS conversations,
       (SELECT COUNT(*) FROM agent_runs r JOIN projects p ON p.id = r.project_id WHERE p.user_id = u.id AND r.created_at >= ?)
     + (SELECT COUNT(*) FROM workflow_runs w JOIN projects p ON p.id = w.project_id WHERE p.user_id = u.id AND w.started_at >= ?) AS runs
     FROM users u ORDER BY conversations + runs DESC, u.id LIMIT ?`, month, month, month, limit,
  ).filter((c) => c.conversations + c.runs > 0);
}
