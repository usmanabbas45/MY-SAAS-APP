import { all, get } from "./db";
import { toMs } from "./live";
import { CRON_INTERVAL_MIN } from "./status";

/**
 * How fresh each connection's data is. "Live" connections push data the moment it happens (your bot, agent,
 * webhook or job calls ProofMyAI); "scheduled" ones are read by ProofMyAI every few minutes. Shows the last data,
 * the last check and the next one, and flags a scheduled check that is overdue, so a stalled connection is
 * never mistaken for a quiet one.
 */
export interface Freshness {
  name: string;
  kind: string;
  delivery: "live" | "scheduled";
  every: string;
  lastData: number | null;
  lastCheck: number | null;
  nextCheck: number | null;
  state: "fresh" | "delayed" | "error" | "waiting" | "quiet";
  note: string;
}

export function connectionFreshness(projectId: number, now = Date.now()): Freshness[] {
  const out: Freshness[] = [];
  const scheduled = (name: string, kind: string, everyMin: number, lastCheck: string | null, lastData: number | null, error: string | null): Freshness => {
    const checked = lastCheck ? toMs(lastCheck) : null;
    const overdue = checked != null && now - checked > Math.max(3 * everyMin, everyMin + 30) * 60000;
    return {
      name, kind, delivery: "scheduled", every: everyMin >= 1440 ? "daily" : `every ${everyMin} min`, lastData, lastCheck: checked,
      nextCheck: checked != null ? checked + everyMin * 60000 : null,
      state: error ? "error" : checked == null ? "waiting" : overdue ? "delayed" : "fresh",
      note: error ? error.slice(0, 160) : checked == null ? "First check is coming up." : overdue ? "The last check is overdue. Monitoring may be paused; see the status page." : "",
    };
  };

  const chat = get<{ last: string | null }>("SELECT MAX(i.created_at) AS last FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND a.status = 'live'", projectId)?.last;
  for (const s of all<{ platform: string; name: string; last_polled_at: string | null; last_error: string | null }>("SELECT platform, name, last_polled_at, last_error FROM chat_sources WHERE project_id = ?", projectId)) {
    out.push(scheduled(s.name, s.platform === "intercom" ? "Intercom" : "Twilio", CRON_INTERVAL_MIN, s.last_polled_at, chat ? toMs(chat) : null, s.last_error));
  }
  if (chat) out.push(live("Chatbot replies", "Your bot / WhatsApp webhook", toMs(chat), now));
  const agent = get<{ last: string | null }>("SELECT MAX(created_at) AS last FROM agent_runs WHERE project_id = ?", projectId)?.last;
  if (agent) out.push(live("AI agent runs", "API or OpenTelemetry", toMs(agent), now));
  const polled = all<{ platform: string; name: string; last_polled_at: string | null; last_error: string | null }>("SELECT platform, name, last_polled_at, last_error FROM workflow_sources WHERE project_id = ?", projectId);
  const lastRun = (platform?: string) => get<{ last: string | null }>(
    `SELECT MAX(started_at) AS last FROM workflow_runs WHERE project_id = ?${platform ? " AND platform = ?" : ""}`, ...(platform ? [projectId, platform] : [projectId]),
  )?.last;
  for (const s of polled) {
    const last = lastRun(s.platform);
    out.push(scheduled(s.name, s.platform === "make" ? "Make" : "n8n", CRON_INTERVAL_MIN, s.last_polled_at, last ? toMs(last) : null, s.last_error));
  }
  const hook = polled.length ? null : lastRun();
  if (hook) out.push(live("Workflow runs sent to ProofMyAI", "Webhook / Error Trigger", toMs(hook), now));
  for (const s of all<{ name: string; last_checked_at: string | null; last_changed_at: string | null; status: string; last_error: string | null }>("SELECT name, last_checked_at, last_changed_at, status, last_error FROM sheet_watches WHERE project_id = ?", projectId)) {
    out.push(scheduled(s.name, "Google Sheet", CRON_INTERVAL_MIN, s.last_checked_at, s.last_changed_at ? toMs(s.last_changed_at) : null, s.status === "error" ? s.last_error ?? "Can't read the sheet" : null));
  }
  for (const s of all<{ provider: string; name: string; last_polled_at: string | null; last_error: string | null; id: number }>("SELECT id, provider, name, last_polled_at, last_error FROM crm_sources WHERE project_id = ?", projectId)) {
    const last = get<{ last: string | null }>("SELECT MAX(first_seen_at) AS last FROM crm_records WHERE source_id = ?", s.id)?.last;
    const push = s.provider === "push";
    out.push(push ? live(s.name, "CRM records sent to ProofMyAI", last ? toMs(last) : null, now) : scheduled(s.name, "CRM", CRON_INTERVAL_MIN, s.last_polled_at, last ? toMs(last) : null, s.last_error));
  }
  for (const h of all<{ name: string; every_min: number; grace_min: number; last_ping_at: string | null; status: string }>("SELECT name, every_min, grace_min, last_ping_at, status FROM job_heartbeats WHERE project_id = ?", projectId)) {
    const last = h.last_ping_at ? toMs(h.last_ping_at) : null;
    const due = last != null ? last + (h.every_min + h.grace_min) * 60000 : null;
    out.push({
      name: h.name, kind: "Heartbeat", delivery: "live", every: `expected every ${h.every_min >= 60 ? `${Math.round(h.every_min / 60)} h` : `${h.every_min} min`}`, lastData: last, lastCheck: null, nextCheck: last != null ? last + h.every_min * 60000 : null,
      state: last == null ? "waiting" : due != null && now > due ? "delayed" : h.status === "failed" ? "error" : "fresh",
      note: last == null ? "Waiting for the first ping." : due != null && now > due ? "The job didn't check in on time." : "",
    });
  }
  for (const m of all<{ name: string; interval_min: number; last_checked_at: string | null; status: string; last_error: string | null }>("SELECT name, interval_min, last_checked_at, status, last_error FROM uptime_monitors WHERE project_id = ?", projectId)) {
    out.push(scheduled(m.name, "Uptime", m.interval_min, m.last_checked_at, m.last_checked_at ? toMs(m.last_checked_at) : null, m.status === "down" ? m.last_error ?? "Down" : null));
  }
  for (const t of all<{ name: string; last_run_at: string | null }>("SELECT name, last_run_at FROM bot_targets WHERE project_id = ?", projectId)) {
    out.push(scheduled(t.name, "Nightly chatbot tests", 1440, t.last_run_at, t.last_run_at ? toMs(t.last_run_at) : null, null));
  }
  return out;
}

function live(name: string, kind: string, last: number | null, now: number): Freshness {
  return {
    name, kind, delivery: "live", every: "instant (seconds)", lastData: last, lastCheck: null, nextCheck: null,
    state: last == null ? "waiting" : now - last > 24 * 3600e3 ? "quiet" : "fresh",
    note: last == null ? "Waiting for the first data." : now - last > 24 * 3600e3 ? "Nothing received in the last 24 hours. Normal if it's quiet; otherwise check the connection." : "",
  };
}
