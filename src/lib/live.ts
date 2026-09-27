import { all, get } from "./db";
import { VERDICT_LABELS, type Verdict } from "./judge/types";

export type Source = "chatbot" | "agents" | "workflows";

export interface FeedEvent {
  source: Source;
  at: number; // epoch ms
  ok: boolean;
  warn: boolean;
  title: string;
  detail: string;
}

export interface SourceStatus {
  source: Source;
  state: "ok" | "problem" | "idle";
  lastAt: number | null;
  lastHour: number;
  problemsLastHour: number;
}

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) and ISO strings both become epoch ms. */
export function toMs(value: string | null): number {
  if (!value) return 0;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function liveFeed(projectId: number, limit = 60): FeedEvent[] {
  const chats = all<{ created_at: string; verdict: Verdict; severity: string; question: string; answer: string; reason: string }>(
    `SELECT i.created_at, COALESCE(i.corrected_verdict, i.verdict) AS verdict, i.severity, i.question, i.answer, i.reason
       FROM audit_items i JOIN audits a ON a.id = i.audit_id
      WHERE a.project_id = ? AND a.status = 'live' ORDER BY i.id DESC LIMIT ?`, projectId, limit,
  ).map<FeedEvent>((r) => ({
    source: "chatbot", at: toMs(r.created_at), ok: r.verdict === "correct", warn: r.verdict !== "correct" && r.severity !== "high",
    title: r.verdict === "correct" ? `Chatbot answered correctly` : `Chatbot: ${VERDICT_LABELS[r.verdict]}`,
    detail: r.verdict === "correct" ? `“${r.question.slice(0, 90)}”` : r.reason,
  }));
  const agents = all<{ created_at: string; agent_name: string; score: number; issues_json: string; total_cost_usd: number }>(
    "SELECT created_at, agent_name, score, issues_json, total_cost_usd FROM agent_runs WHERE project_id = ? ORDER BY id DESC LIMIT ?", projectId, limit,
  ).map<FeedEvent>((r) => {
    const issues = (JSON.parse(r.issues_json) as { code: string; message: string }[]).filter((i) => !["AI_REVIEW_PASSED", "AI_REVIEW_SKIPPED"].includes(i.code));
    return {
      source: "agents", at: toMs(r.created_at), ok: issues.length === 0, warn: issues.length > 0 && r.score >= 65,
      title: issues.length ? `Agent “${r.agent_name}”: ${issues.map((i) => i.code.replace(/_/g, " ").toLowerCase()).join(", ")}` : `Agent “${r.agent_name}” run OK`,
      detail: issues.length ? issues[0].message : `Score ${Math.round(r.score)} · $${r.total_cost_usd.toFixed(4)}`,
    };
  });
  const flows = all<{ started_at: string; platform: string; workflow_name: string; status: string; output_items: number | null; error_message: string | null; duration_ms: number | null }>(
    "SELECT started_at, platform, workflow_name, status, output_items, error_message, duration_ms FROM workflow_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?", projectId, limit,
  ).map<FeedEvent>((r) => {
    const silent = r.status === "success" && r.output_items === 0;
    const failed = r.status === "error";
    return {
      source: "workflows", at: toMs(r.started_at), ok: !failed && !silent, warn: silent || r.status === "warning",
      title: failed ? `${r.platform} “${r.workflow_name}” failed` : silent ? `${r.platform} “${r.workflow_name}” produced nothing` : `${r.platform} “${r.workflow_name}” ran OK`,
      detail: failed ? (r.error_message ?? "Execution error") : silent ? "Reported success with 0 output items" : `${r.output_items ?? "–"} items${r.duration_ms != null ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ""}`,
    };
  });
  return [...chats, ...agents, ...flows].sort((a, b) => b.at - a.at).slice(0, limit);
}

export function sourceStatuses(projectId: number, now = Date.now()): SourceStatus[] {
  const hourAgoSql = new Date(now - 3600e3).toISOString().replace("T", " ").slice(0, 19);
  const hourAgoIso = new Date(now - 3600e3).toISOString();
  const chat = get<{ last: string | null; n: number; bad: number | null }>(
    `SELECT MAX(i.created_at) AS last,
            SUM(CASE WHEN i.created_at >= ? THEN 1 ELSE 0 END) AS n,
            SUM(CASE WHEN i.created_at >= ? AND COALESCE(i.corrected_verdict, i.verdict) <> 'correct' THEN 1 ELSE 0 END) AS bad
       FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND a.status = 'live'`,
    hourAgoSql, hourAgoSql, projectId,
  );
  const agents = get<{ last: string | null; n: number; bad: number | null }>(
    `SELECT MAX(created_at) AS last, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS n,
            SUM(CASE WHEN created_at >= ? AND score < 65 THEN 1 ELSE 0 END) AS bad FROM agent_runs WHERE project_id = ?`,
    hourAgoSql, hourAgoSql, projectId,
  );
  const flows = get<{ last: string | null; n: number; bad: number | null }>(
    `SELECT MAX(started_at) AS last, SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS n,
            SUM(CASE WHEN started_at >= ? AND (status = 'error' OR (status = 'success' AND output_items = 0)) THEN 1 ELSE 0 END) AS bad
       FROM workflow_runs WHERE project_id = ?`,
    hourAgoIso, hourAgoIso, projectId,
  );
  const make = (source: Source, r: { last: string | null; n: number; bad: number | null } | undefined): SourceStatus => {
    const lastAt = r?.last ? toMs(r.last) : null;
    const problems = r?.bad ?? 0;
    const recent = lastAt != null && now - lastAt < 24 * 3600e3;
    return { source, lastAt, lastHour: r?.n ?? 0, problemsLastHour: problems, state: problems > 0 ? "problem" : recent ? "ok" : "idle" };
  };
  return [make("chatbot", chat), make("agents", agents), make("workflows", flows)];
}
