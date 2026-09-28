import { cookies } from "next/headers";
import { get, run } from "./db";

/**
 * Conversion tracking through the GA4 Measurement Protocol (server-side): sign-ups, contact requests,
 * trial starts and first payments. Sent from the server, so ad blockers don't hide them and events that
 * happen later (a Paddle payment after the trial) are still credited to the visitor who signed up.
 * Needs GA_MEASUREMENT_ID and GA_API_SECRET; does nothing otherwise. No emails or names are sent.
 */

export type GaIds = { clientId: string; sessionId?: string };

/** Reads the visitor's GA client ID (_ga cookie) and current session ID (_ga_<container> cookie). */
export function parseGaCookies(all: { name: string; value: string }[], measurementId = process.env.GA_MEASUREMENT_ID ?? ""): GaIds | null {
  const ga = all.find((c) => c.name === "_ga")?.value;
  const m = ga?.match(/^GA\d\.\d\.(\d+\.\d+)$/);
  if (!m) return null;
  const container = `_ga_${measurementId.replace(/^G-/, "")}`;
  const s = all.find((c) => c.name === container)?.value ?? "";
  // Old format "GS1.1.<session>.<n>..." and new format "GS2.1.s<session>$o1$g1..."
  const session = s.match(/^GS1\.\d\.(\d+)\./)?.[1] ?? s.match(/^GS2\.\d\.s(\d+)/)?.[1];
  return { clientId: m[1], sessionId: session };
}

export async function currentGaIds(): Promise<GaIds | null> {
  try {
    return parseGaCookies((await cookies()).getAll());
  } catch {
    return null; // outside a request (webhooks, cron)
  }
}

export function gaEnabled(): boolean {
  return Boolean(process.env.GA_MEASUREMENT_ID?.trim() && process.env.GA_API_SECRET?.trim());
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Sends one event. Never throws: analytics must not break sign-ups or billing. */
export async function trackEvent(ids: GaIds | null, name: string, params: Record<string, string | number> = {}, fetcher: Fetcher = fetch): Promise<boolean> {
  if (!gaEnabled() || !ids) return false;
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(process.env.GA_MEASUREMENT_ID!.trim())}&api_secret=${encodeURIComponent(process.env.GA_API_SECRET!.trim())}`;
  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: ids.clientId,
        events: [{ name, params: { ...params, engagement_time_msec: 1, ...(ids.sessionId ? { session_id: ids.sessionId } : {}) } }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err) {
    console.error(`[ga] ${name} not sent:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Remembers which GA visitor a user is, so later server events (trial, payment) are credited correctly. */
export function rememberGaClient(userId: number, ids: GaIds | null): void {
  if (ids) run("UPDATE users SET ga_client_id = ? WHERE id = ?", ids.clientId, userId);
}

export function userGaIds(userId: number): GaIds | null {
  const id = get<{ c: string | null }>("SELECT ga_client_id AS c FROM users WHERE id = ?", userId)?.c;
  return id ? { clientId: id } : null;
}
