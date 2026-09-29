import { billingEnabled } from "./billing";
import { all, get, run } from "./db";
import { judgeProvider } from "./judge/llm";

/** Background checks are expected every 15 minutes (cron-job.org calling /api/cron). */
export const CRON_INTERVAL_MIN = 15;
const RUNS_PER_DAY = (24 * 60) / CRON_INTERVAL_MIN;

export type Health = "operational" | "degraded" | "outage" | "not_configured";

export interface Component {
  name: string;
  description: string;
  health: Health;
  detail: string;
}

/** Records one background-check run (called at the end of /api/cron). */
export function recordCronRun(ok: boolean, detail = "", now = new Date()): void {
  const at = now.toISOString();
  run(
    "INSERT INTO heartbeats (name, last_run_at, ok, detail) VALUES ('cron', ?, ?, ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at, ok = excluded.ok, detail = excluded.detail",
    at, ok ? 1 : 0, detail.slice(0, 300),
  );
  run(
    "INSERT INTO uptime_days (day, cron_runs, cron_failures) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET cron_runs = cron_runs + 1, cron_failures = cron_failures + excluded.cron_failures",
    at.slice(0, 10), ok ? 0 : 1,
  );
}

function minutesAgo(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 60000;
}

export function components(now = new Date()): Component[] {
  const out: Component[] = [];

  let dbOk = true;
  let dbMs = 0;
  try {
    const t = performance.now();
    get("SELECT COUNT(*) FROM users");
    dbMs = performance.now() - t;
  } catch {
    dbOk = false;
  }
  out.push({ name: "Website & dashboard", description: "proofmyai.com and the app", health: "operational", detail: "Responding" });
  out.push({ name: "Data API", description: "Chat events, agent runs and workflow runs", health: dbOk ? "operational" : "outage", detail: dbOk ? "Accepting data" : "Cannot store data right now" });
  out.push({ name: "Database", description: "Stores your results", health: dbOk ? (dbMs > 500 ? "degraded" : "operational") : "outage", detail: dbOk ? `Query time ${Math.max(1, Math.round(dbMs))} ms` : "Not reachable" });

  const hb = dbOk ? get<{ last_run_at: string; ok: number; detail: string | null }>("SELECT last_run_at, ok, detail FROM heartbeats WHERE name = 'cron'") : undefined;
  let bg: Component = { name: "Background checks", description: "n8n/Make polling, nightly bot tests, missing-reply alerts", health: "not_configured", detail: "Waiting for the first scheduled run" };
  if (hb) {
    const ago = minutesAgo(hb.last_run_at, now);
    const when = ago < 1 ? "just now" : ago < 90 ? `${Math.round(ago)} min ago` : `${Math.round(ago / 60)} h ago`;
    bg = {
      ...bg,
      health: ago > 120 ? "outage" : ago > CRON_INTERVAL_MIN * 2 + 5 || !hb.ok ? "degraded" : "operational",
      detail: hb.ok ? `Last run ${when}` : `Last run ${when} had an error`,
    };
  }
  out.push(bg);

  const ai = judgeProvider();
  out.push({
    name: "AI answer checking", description: "Grading answers against your help articles",
    health: ai ? "operational" : "degraded",
    detail: ai ? `Running (${ai === "anthropic" ? "Anthropic Claude" : "Google Gemini"})` : "AI checking unavailable: rule-based checks only",
  });
  out.push({
    name: "Email alerts", description: "Alerts, reports and password resets",
    health: process.env.RESEND_API_KEY ? "operational" : "degraded",
    detail: process.env.RESEND_API_KEY ? "Sending" : "Email delivery paused: use Slack, Teams, Telegram or webhook alerts",
  });
  out.push({
    name: "Billing", description: "Checkout and subscriptions (Paddle)",
    health: billingEnabled() ? "operational" : "not_configured",
    detail: billingEnabled() ? "Operational" : "Checkout not available",
  });
  return out;
}

export function overall(list: Component[]): Health {
  if (list.some((c) => c.health === "outage")) return "outage";
  if (list.some((c) => c.health === "degraded")) return "degraded";
  return "operational";
}

export interface Day { day: string; pct: number | null; runs: number; failures: number }

/** Share of scheduled background runs that happened and succeeded, per day (today counts only elapsed time). */
export function uptimeHistory(days = 30, now = new Date()): Day[] {
  const rows = new Map(all<{ day: string; cron_runs: number; cron_failures: number }>("SELECT * FROM uptime_days WHERE day >= ?", new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10)).map((r) => [r.day, r]));
  const first = get<{ d: string | null }>("SELECT MIN(day) AS d FROM uptime_days")?.d ?? null;
  const out: Day[] = [];
  const today = now.toISOString().slice(0, 10);
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
    const r = rows.get(day);
    if (!first || day < first) { out.push({ day, pct: null, runs: 0, failures: 0 }); continue; }
    let expected = RUNS_PER_DAY;
    if (day === today) expected = Math.max(1, Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / CRON_INTERVAL_MIN));
    if (day === first) expected = Math.max(1, Math.min(expected, r?.cron_runs ?? 1));
    const good = (r?.cron_runs ?? 0) - (r?.cron_failures ?? 0);
    out.push({ day, pct: Math.min(100, (good / expected) * 100), runs: r?.cron_runs ?? 0, failures: r?.cron_failures ?? 0 });
  }
  return out;
}

export function averageUptime(history: Day[]): number | null {
  const known = history.filter((d) => d.pct !== null);
  if (known.length === 0) return null;
  return known.reduce((s, d) => s + (d.pct ?? 0), 0) / known.length;
}
