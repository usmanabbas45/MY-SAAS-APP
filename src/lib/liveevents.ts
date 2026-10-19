import { run } from "./db";

/**
 * Events for the Live tracking feed from checks that run on a schedule or on request (CRMs, heartbeats, approvals,
 * result checks), alongside the chatbot, agent and workflow events that come from their own tables.
 */
export type LiveEventSource = "chatbot" | "agents" | "workflows" | "crm";
export type LiveLevel = "ok" | "warn" | "bad";

export function logLiveEvent(projectId: number, source: LiveEventSource, level: LiveLevel, title: string, detail: string, at = new Date()): void {
  run(
    "INSERT INTO live_events (project_id, source, at, level, title, detail) VALUES (?, ?, ?, ?, ?, ?)",
    projectId, source, at.toISOString(), level, title.slice(0, 300), detail.slice(0, 600),
  );
  // Keep 30 days; cheap because of the (project_id, at) index.
  if (Math.random() < 0.02) run("DELETE FROM live_events WHERE at < ?", new Date(at.getTime() - 30 * 86400000).toISOString());
}
