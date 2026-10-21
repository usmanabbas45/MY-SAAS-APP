import { all, run } from "./db";

/**
 * End-to-end traces: one id that a customer sends with every step of one request (the chatbot reply, the agent run,
 * the workflow execution, the approval, the outcome check). Every step is recorded here so the whole journey shows
 * on one timeline, and the first failing step stands out.
 */
export type TraceSource = "chatbot" | "agents" | "workflows" | "approvals" | "verify";

export interface TraceEvent { source: TraceSource; ok: boolean; title: string; detail: string; at: string }

export function recordTrace(projectId: number, traceId: string | null | undefined, source: TraceSource, ok: boolean, title: string, detail = "", at = new Date()): void {
  if (!traceId) return;
  run("INSERT INTO trace_events (project_id, trace_id, source, ok, title, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    projectId, traceId.slice(0, 200), source, ok ? 1 : 0, title.slice(0, 300), detail.slice(0, 1000), at.toISOString());
  // Traces are for debugging recent requests: anything older than 90 days is cleared now and then.
  if (Math.random() < 0.02) run("DELETE FROM trace_events WHERE at < ?", new Date(at.getTime() - 90 * 86400000).toISOString());
}

export function traceTimeline(projectId: number, traceId: string): TraceEvent[] {
  return all<{ source: TraceSource; ok: number; title: string; detail: string; at: string }>(
    "SELECT source, ok, title, detail, at FROM trace_events WHERE project_id = ? AND trace_id = ? ORDER BY at, id LIMIT 500", projectId, traceId,
  ).map((e) => ({ ...e, ok: e.ok === 1 }));
}

export function recentTraces(projectId: number, limit = 20): { traceId: string; steps: number; failed: number; last: string }[] {
  return all<{ trace_id: string; steps: number; failed: number; last: string }>(
    `SELECT trace_id, COUNT(*) AS steps, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed, MAX(at) AS last
       FROM trace_events WHERE project_id = ? GROUP BY trace_id ORDER BY last DESC LIMIT ?`, projectId, limit,
  ).map((r) => ({ traceId: r.trace_id, steps: r.steps, failed: r.failed, last: r.last }));
}
