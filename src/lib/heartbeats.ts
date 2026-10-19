import { all, get, run } from "./db";
import { raiseIncident, resolveIncidents } from "./incidents";
import { logLiveEvent } from "./liveevents";
import { randomToken } from "./security";

/**
 * Heartbeats (dead man's switch) for anything that runs on a schedule: a cron job, a script, a Zapier zap or an n8n
 * workflow triggered by a webhook. It calls its own secret URL when it finishes; if the call doesn't arrive on time,
 * ProofMyAI alerts. This catches the failure no error handler can: the job that never started.
 */
export const HEARTBEAT_EVERY = [5, 15, 30, 60, 360, 1440, 10080] as const;

export interface Heartbeat {
  id: number; project_id: number; name: string; token: string; every_min: number; grace_min: number;
  status: "new" | "up" | "late" | "failed"; last_ping_at: string | null; last_message: string | null; created_at: string;
}

export const graceFor = (everyMin: number) => Math.max(5, Math.round(everyMin * 0.2));
export const everyLabel = (m: number) => (m === 10080 ? "week" : m >= 1440 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m >= 60 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`);

export function addHeartbeat(projectId: number, name: string, everyMin: number): Heartbeat {
  const id = run(
    "INSERT INTO job_heartbeats (project_id, name, token, every_min, grace_min, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    projectId, name, `hb_${randomToken(18)}`, everyMin, graceFor(everyMin), new Date().toISOString(),
  ).lastInsertRowid;
  return get<Heartbeat>("SELECT * FROM job_heartbeats WHERE id = ?", id)!;
}

/** A ping from the job. `failed` when the job reports its own failure (…/fail). */
export async function ping(token: string, failed: boolean, message: string | null, now = new Date()): Promise<Heartbeat | null> {
  const h = get<Heartbeat>("SELECT * FROM job_heartbeats WHERE token = ?", token);
  if (!h) return null;
  run("UPDATE job_heartbeats SET last_ping_at = ?, status = ?, last_message = ? WHERE id = ?", now.toISOString(), failed ? "failed" : "up", message, h.id);
  if (failed) {
    logLiveEvent(h.project_id, "workflows", "bad", `Heartbeat "${h.name}" reported a failure`, message ?? "The job called its failure URL.", now);
    await raiseIncident(h.project_id, {
      module: "workflows", code: "HEARTBEAT_FAILED", severity: "high", title: `"${h.name}" reported a failure`,
      detail: message ? `It said: ${message}` : "The job called its failure URL. Check its logs.", dedupeKey: `hb:${h.id}`,
    });
  } else {
    if (h.status !== "up") logLiveEvent(h.project_id, "workflows", "ok", h.status === "new" ? `Heartbeat "${h.name}": first check-in` : `Heartbeat "${h.name}" is back on time`, message ?? "Checked in.", now);
    resolveIncidents(h.project_id, `hb:${h.id}`);
  }
  return h;
}

/** Every minute: heartbeats whose next ping is overdue. */
export async function checkHeartbeats(now = new Date()): Promise<number> {
  const due = all<Heartbeat>(
    `SELECT h.* FROM job_heartbeats h JOIN projects p ON p.id = h.project_id WHERE p.is_demo = 0 AND h.status IN ('new', 'up')`,
  );
  let late = 0;
  for (const h of due) {
    const since = Date.parse(h.last_ping_at ?? h.created_at);
    if (now.getTime() - since <= (h.every_min + h.grace_min) * 60000) continue;
    run("UPDATE job_heartbeats SET status = 'late' WHERE id = ?", h.id);
    late++;
    logLiveEvent(h.project_id, "workflows", "bad", `"${h.name}" didn't run on time`, `No check-in for ${Math.round((now.getTime() - since) / 60000)} minutes.`, now);
    await raiseIncident(h.project_id, {
      module: "workflows", code: "HEARTBEAT_MISSED", severity: "high", title: `"${h.name}" didn't run on time`,
      detail: h.last_ping_at
        ? `Last check-in ${Math.round((now.getTime() - since) / 60000)} minutes ago; it should check in every ${everyLabel(h.every_min)}. The job may not have started at all: a stopped schedule, a dead server or a disabled trigger.`
        : `It hasn't checked in once since it was added. Make sure the job calls its heartbeat URL when it finishes.`,
      dedupeKey: `hb:${h.id}`,
    });
  }
  return late;
}
