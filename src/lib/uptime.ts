import { all, get, run } from "./db";
import { raiseIncident, resolveIncidents } from "./incidents";
import { safeFetch } from "./security";

/**
 * Uptime monitoring: checks a chatbot, website or API URL every few minutes, records response time,
 * raises an incident (and alerts) after 2 failed checks in a row and resolves it when the URL is back.
 */
export interface Monitor {
  id: number; project_id: number; name: string; url: string; keyword: string | null; interval_min: number;
  status: "pending" | "up" | "down"; fails: number; last_checked_at: string | null; last_ms: number | null;
  last_code: number | null; last_error: string | null; down_since: string | null; created_at: string;
}

export const INTERVALS = [1, 5, 15, 60] as const;
const FAILS_TO_ALERT = 2;
const SLOW_MS = 5000;
const KEEP_DAYS = 30;
type Fetcher = (url: string, init: RequestInit, timeoutMs: number) => Promise<Response>;

export interface CheckResult { ok: boolean; ms: number; code: number | null; error: string | null }

export async function probe(url: string, keyword: string | null, fetcher: Fetcher = safeFetch): Promise<CheckResult> {
  const started = Date.now();
  try {
    const res = await fetcher(url, { method: "GET", headers: { "User-Agent": "ProofMyAI-Uptime/1.0 (+https://proofmyai.com)" }, cache: "no-store" }, 15000);
    const ms = Date.now() - started;
    if (res.status >= 400) return { ok: false, ms, code: res.status, error: `HTTP ${res.status}` };
    if (keyword) {
      const body = (await res.text()).slice(0, 2_000_000);
      if (!body.toLowerCase().includes(keyword.toLowerCase())) return { ok: false, ms, code: res.status, error: `The page loaded but "${keyword}" was not found on it.` };
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return { ok: true, ms, code: res.status, error: null };
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "TimeoutError" || /abort|timeout/i.test(err.message) ? "No response within 15 seconds" : err.message) : "Request failed";
    return { ok: false, ms: Date.now() - started, code: null, error: msg.slice(0, 300) };
  }
}

const minutesBetween = (a: string, b: Date) => Math.max(1, Math.round((b.getTime() - Date.parse(a.endsWith("Z") ? a : `${a}Z`)) / 60000));

/** Runs one check and updates state, incidents and alerts. */
export async function checkMonitor(m: Monitor, fetcher?: Fetcher, now = new Date()): Promise<CheckResult> {
  const r = await probe(m.url, m.keyword, fetcher);
  const at = now.toISOString();
  run("INSERT INTO uptime_checks (monitor_id, at, ok, ms, code) VALUES (?, ?, ?, ?, ?)", m.id, at, r.ok ? 1 : 0, r.ms, r.code);
  const key = `uptime:${m.id}`;
  if (r.ok) {
    run("UPDATE uptime_monitors SET status = 'up', fails = 0, last_checked_at = ?, last_ms = ?, last_code = ?, last_error = NULL, down_since = NULL WHERE id = ?", at, r.ms, r.code, m.id);
    if (m.status === "down") resolveIncidents(m.project_id, key);
    if (r.ms > SLOW_MS) {
      await raiseIncident(m.project_id, {
        module: "uptime", code: "UPTIME_SLOW", severity: "medium", title: `${m.name} is slow`,
        detail: `${m.url} took ${(r.ms / 1000).toFixed(1)} seconds to respond.`, dedupeKey: `${key}:slow`,
      });
    } else {
      resolveIncidents(m.project_id, `${key}:slow`);
    }
    return r;
  }
  const fails = m.fails + 1;
  const goesDown = fails >= FAILS_TO_ALERT && m.status !== "down";
  run(
    "UPDATE uptime_monitors SET status = ?, fails = ?, last_checked_at = ?, last_ms = ?, last_code = ?, last_error = ?, down_since = COALESCE(down_since, ?) WHERE id = ?",
    goesDown || m.status === "down" ? "down" : m.status, fails, at, r.ms, r.code, r.error, at, m.id,
  );
  if (goesDown) {
    await raiseIncident(m.project_id, {
      module: "uptime", code: "UPTIME_DOWN", severity: "high", title: `${m.name} is down`,
      detail: `${m.url} failed ${fails} checks in a row: ${r.error}. Down for about ${m.down_since ? minutesBetween(m.down_since, now) : fails * m.interval_min} minutes.`,
      dedupeKey: key,
    });
  }
  return r;
}

/** Checks every monitor that is due. Called every minute by the background timer and by the cron as a backup. */
export async function runDueMonitors(now = new Date(), fetcher?: Fetcher): Promise<number> {
  const due = all<Monitor>(
    `SELECT * FROM uptime_monitors WHERE (last_checked_at IS NULL OR datetime(last_checked_at) <= datetime(?, '-' || (interval_min * 60 - 20) || ' seconds'))
       AND project_id NOT IN (SELECT id FROM projects WHERE is_demo = 1)`,
    now.toISOString(),
  );
  let n = 0;
  for (let i = 0; i < due.length; i += 10) {
    await Promise.all(due.slice(i, i + 10).map((m) => checkMonitor(m, fetcher, now).then(() => n++).catch((err) => console.error("[uptime]", err))));
  }
  run("DELETE FROM uptime_checks WHERE at < ?", new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString());
  return n;
}

export interface MonitorStats { uptime24h: number | null; uptime7d: number | null; uptime30d: number | null; avgMs: number | null; recent: { ok: number; ms: number | null; at: string }[] }

export function monitorStats(monitorId: number, now = new Date()): MonitorStats {
  const pct = (days: number) => {
    const r = get<{ n: number; up: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(ok), 0) AS up FROM uptime_checks WHERE monitor_id = ? AND at >= ?", monitorId, new Date(now.getTime() - days * 86400000).toISOString());
    return r && r.n ? Math.round((r.up / r.n) * 10000) / 100 : null;
  };
  const avg = get<{ a: number | null }>("SELECT AVG(ms) AS a FROM uptime_checks WHERE monitor_id = ? AND ok = 1 AND at >= ?", monitorId, new Date(now.getTime() - 86400000).toISOString())?.a ?? null;
  const recent = all<{ ok: number; ms: number | null; at: string }>("SELECT ok, ms, at FROM uptime_checks WHERE monitor_id = ? ORDER BY at DESC LIMIT 48", monitorId).reverse();
  return { uptime24h: pct(1), uptime7d: pct(7), uptime30d: pct(30), avgMs: avg == null ? null : Math.round(avg), recent };
}
