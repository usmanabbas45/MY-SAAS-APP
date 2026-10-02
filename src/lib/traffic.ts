import crypto from "node:crypto";
import { all, get, run, transaction } from "./db";
import { derivedKey } from "./security";

/**
 * Privacy-friendly website analytics without cookies (so no consent banner is needed).
 * A visitor is counted once a day using a salted hash of IP + browser that changes every day
 * and is deleted the next day, so nobody can be tracked across days. Only daily totals are kept.
 */

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|axios|node-fetch|go-http|facebookexternalhit|embedly/i;
/** Private areas are never counted. */
const PRIVATE = ["/app", "/api", "/r", "/reset-password"];

export function cleanPath(raw: string): string | null {
  let path = String(raw || "").split(/[?#]/)[0].slice(0, 120);
  if (!path.startsWith("/")) return null;
  if (PRIVATE.some((p) => { const base = p.replace(/\/$/, ""); return path === base || path.startsWith(`${base}/`); })) return null;
  path = path.replace(/\/+$/, "") || "/";
  return /^[\w\-./%~]*$/.test(path) ? path : null;
}

/** "google.com", "linkedin.com", "chatgpt.com"… or "Direct". Own site counts as internal (ignored). */
export function sourceOf(referrer: string, utmSource: string, ownHost: string): string | null {
  const utm = utmSource.trim().toLowerCase().replace(/[^\w.\-]/g, "").slice(0, 40);
  if (utm) return utm;
  if (!referrer) return "Direct";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").replace(/^(m|l|lm)\./, "");
    if (!host || host === ownHost.replace(/^www\./, "")) return null;
    if (/(^|\.)google\./.test(host)) return "google";
    if (/(^|\.)bing\.com$/.test(host)) return "bing";
    if (host === "t.co") return "x.com";
    return host.slice(0, 60);
  } catch {
    return "Direct";
  }
}

const today = (now = new Date()) => now.toISOString().slice(0, 10);

export function recordPageView(input: { path: string; referrer: string; utm: string; ip: string; ua: string; host: string }, now = new Date()): boolean {
  if (!input.ua || BOT.test(input.ua)) return false;
  const path = cleanPath(input.path);
  if (!path) return false;
  const day = today(now);
  const hash = crypto.createHash("sha256").update(`${derivedKey("traffic-salt")}:${day}:${input.ip}:${input.ua}`).digest("hex").slice(0, 20);
  transaction(() => {
    run("DELETE FROM traffic_seen WHERE day < ?", day);
    const isNew = run("INSERT OR IGNORE INTO traffic_seen (day, hash) VALUES (?, ?)", day, hash).changes > 0;
    run(`INSERT INTO traffic_pages (day, path, views) VALUES (?, ?, 1) ON CONFLICT(day, path) DO UPDATE SET views = views + 1`, day, path);
    run(`INSERT INTO traffic_days (day, visitors, views) VALUES (?, ?, 1) ON CONFLICT(day) DO UPDATE SET views = views + 1, visitors = visitors + ?`, day, isNew ? 1 : 0, isNew ? 1 : 0);
    const source = sourceOf(input.referrer, input.utm, input.host);
    if (isNew && source) run(`INSERT INTO traffic_sources (day, source, visits) VALUES (?, ?, 1) ON CONFLICT(day, source) DO UPDATE SET visits = visits + 1`, day, source);
  });
  return true;
}

export interface TrafficSummary {
  visitors: number; views: number;
  daily: { day: string; visitors: number; views: number }[];
  pages: { path: string; views: number }[];
  sources: { source: string; visits: number }[];
}

export function trafficSummary(days: number, now = new Date()): TrafficSummary {
  const since = today(new Date(now.getTime() - (days - 1) * 86400000));
  const rows = all<{ day: string; visitors: number; views: number }>("SELECT day, visitors, views FROM traffic_days WHERE day >= ? ORDER BY day", since);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const daily = Array.from({ length: days }, (_, i) => {
    const d = today(new Date(now.getTime() - (days - 1 - i) * 86400000));
    return byDay.get(d) ?? { day: d, visitors: 0, views: 0 };
  });
  const tot = get<{ v: number; p: number }>("SELECT COALESCE(SUM(visitors),0) AS v, COALESCE(SUM(views),0) AS p FROM traffic_days WHERE day >= ?", since)!;
  return {
    visitors: tot.v, views: tot.p, daily,
    pages: all("SELECT path, SUM(views) AS views FROM traffic_pages WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 15", since),
    sources: all("SELECT source, SUM(visits) AS visits FROM traffic_sources WHERE day >= ? GROUP BY source ORDER BY visits DESC LIMIT 15", since),
  };
}
