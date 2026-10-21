import { z } from "zod";
import { all, get, run } from "./db";
import { raiseIncident, resolveIncidents, type Module } from "./incidents";

/**
 * Custom watches: the customer writes what to watch in plain English ("alert me if the Order sync workflow
 * runs fewer than 10 times a day", "tell me when an agent run costs more than $1"). The prompt is translated once
 * into a small, structured rule (by the AI when available, otherwise by a built-in parser), shown back to the
 * customer as "ProofMyAI understood this as…", and then checked deterministically on every new event and every
 * 15 minutes. No AI runs per event, so watches are fast, cheap and predictable.
 */
export const WATCH_MODULES = ["chatbot", "agents", "workflows", "approvals", "crm", "uptime", "incidents"] as const;
export type WatchModule = (typeof WATCH_MODULES)[number];

type FieldType = "text" | "number" | "bool";
interface FieldDef { sql: string; type: FieldType; label: string; values?: string[] }
interface SourceDef {
  label: string;
  /** FROM … WHERE project = ? */
  from: string;
  /** Time column, and whether it stores ISO ("2026-10-21T10:00:00.000Z") or SQLite ("2026-10-21 10:00:00") times. */
  time: string;
  iso: boolean;
  /** Short description of one matching row, for the alert. */
  describe: string;
  fields: Record<string, FieldDef>;
  alertModule: Module;
  examples: string[];
}

export const SOURCES: Record<WatchModule, SourceDef> = {
  chatbot: {
    label: "chatbot answers",
    from: "FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ?",
    time: "replace(COALESCE(i.created_at, a.created_at), 'T', ' ')", iso: false,
    describe: "'“' || substr(i.question, 1, 80) || '” → ' || substr(i.answer, 1, 120)",
    fields: {
      verdict: { sql: "COALESCE(i.corrected_verdict, i.verdict)", type: "text", label: "verdict", values: ["correct", "unsupported", "hallucination", "should_escalate", "off_policy", "unclear"] },
      severity: { sql: "i.severity", type: "text", label: "severity", values: ["none", "low", "medium", "high"] },
      question: { sql: "i.question", type: "text", label: "customer question" },
      answer: { sql: "i.answer", type: "text", label: "bot answer" },
      reason: { sql: "i.reason", type: "text", label: "reason" },
      topic: { sql: "i.topic", type: "text", label: "topic" },
      response_ms: { sql: "i.latency_ms", type: "number", label: "response time (ms)" },
    },
    alertModule: "chatbot",
    examples: ["Alert me when the bot gives more than 3 made-up answers in an hour", "Tell me whenever an answer mentions a refund", "Notify me if a reply takes longer than 10 seconds"],
  },
  agents: {
    label: "AI agent runs",
    from: "FROM agent_runs r WHERE r.project_id = ?",
    time: "replace(r.created_at, 'T', ' ')", iso: false,
    describe: "'Agent “' || r.agent_name || '”, ' || r.status || ', $' || printf('%.4f', r.total_cost_usd) || ', ' || json_array_length(r.steps_json) || ' steps'",
    fields: {
      agent_name: { sql: "r.agent_name", type: "text", label: "agent name" },
      status: { sql: "r.status", type: "text", label: "status", values: ["success", "error", "timeout", "cancelled"] },
      cost_usd: { sql: "r.total_cost_usd", type: "number", label: "cost ($)" },
      duration_ms: { sql: "r.total_ms", type: "number", label: "duration (ms)" },
      steps: { sql: "json_array_length(r.steps_json)", type: "number", label: "steps" },
      score: { sql: "r.score", type: "number", label: "score" },
      output: { sql: "r.final_output", type: "text", label: "final output" },
    },
    alertModule: "agents",
    examples: ["Alert me if any agent run costs more than $1", "Tell me when the Refund agent fails twice in an hour", "Notify me if an agent takes more than 20 steps"],
  },
  workflows: {
    label: "n8n, Make and webhook workflow runs",
    from: "FROM workflow_runs w WHERE w.project_id = ?",
    time: "w.started_at", iso: true,
    describe: "'“' || w.workflow_name || '” ' || w.status || COALESCE(', ' || w.output_items || ' items out', '')",
    fields: {
      workflow_name: { sql: "w.workflow_name", type: "text", label: "workflow name" },
      platform: { sql: "w.platform", type: "text", label: "platform" },
      status: { sql: "w.status", type: "text", label: "status", values: ["success", "error", "warning", "running", "waiting", "cancelled"] },
      output_items: { sql: "w.output_items", type: "number", label: "items out" },
      input_items: { sql: "w.input_items", type: "number", label: "items in" },
      duration_ms: { sql: "w.duration_ms", type: "number", label: "duration (ms)" },
      error: { sql: "w.error_message", type: "text", label: "error message" },
    },
    alertModule: "workflows",
    examples: ["Alert me if the Order sync workflow runs fewer than 10 times a day", "Tell me when any workflow returns 0 items", "Notify me if Lead import hasn't run for 2 hours"],
  },
  approvals: {
    label: "approval requests",
    from: "FROM approvals ap WHERE ap.project_id = ?",
    time: "ap.created_at", iso: true,
    describe: "ap.action || ': ' || substr(ap.summary, 1, 100) || COALESCE(' (' || ap.amount || ' ' || COALESCE(ap.currency, '') || ')', '')",
    fields: {
      action: { sql: "ap.action", type: "text", label: "action" },
      summary: { sql: "ap.summary", type: "text", label: "summary" },
      category: { sql: "ap.category", type: "text", label: "category" },
      amount: { sql: "ap.amount", type: "number", label: "amount" },
      status: { sql: "ap.status", type: "text", label: "status", values: ["pending", "approved", "rejected", "expired"] },
      agent_name: { sql: "ap.agent_name", type: "text", label: "agent name" },
    },
    alertModule: "agents",
    examples: ["Alert me for any refund over 200", "Tell me if more than 5 actions get rejected in a day", "Notify me when the agent asks to pay a new supplier"],
  },
  crm: {
    label: "new CRM records",
    from: "FROM crm_records c JOIN crm_sources s ON s.id = c.source_id WHERE s.project_id = ?",
    time: "c.first_seen_at", iso: true,
    describe: "s.name || ' record' || CASE WHEN c.has_email = 0 THEN ', no email' ELSE '' END || CASE WHEN c.has_owner = 0 THEN ', no owner' ELSE '' END",
    fields: {
      crm: { sql: "s.name", type: "text", label: "CRM" },
      kind: { sql: "c.kind", type: "text", label: "record type" },
      has_email: { sql: "c.has_email", type: "bool", label: "has email" },
      has_phone: { sql: "c.has_phone", type: "bool", label: "has phone" },
      has_owner: { sql: "c.has_owner", type: "bool", label: "has owner" },
    },
    alertModule: "workflows",
    examples: ["Alert me if fewer than 5 new leads arrive in a day", "Tell me when a new lead has no email", "Notify me if no new leads for 3 hours"],
  },
  uptime: {
    label: "uptime checks",
    from: "FROM uptime_checks u JOIN uptime_monitors m ON m.id = u.monitor_id WHERE m.project_id = ?",
    time: "u.at", iso: true,
    describe: "m.name || CASE WHEN u.ok = 1 THEN ' up, ' || COALESCE(u.ms, '?') || ' ms' ELSE ' down (' || COALESCE(u.code, 'no answer') || ')' END",
    fields: {
      monitor: { sql: "m.name", type: "text", label: "monitor" },
      up: { sql: "u.ok", type: "bool", label: "up" },
      response_ms: { sql: "u.ms", type: "number", label: "response time (ms)" },
      status_code: { sql: "u.code", type: "number", label: "HTTP status" },
    },
    alertModule: "uptime",
    examples: ["Alert me if the website takes longer than 3 seconds to answer", "Tell me if the chatbot API is down twice in an hour"],
  },
  incidents: {
    label: "problems ProofMyAI finds (Google Sheets, heartbeats, CRM…)",
    from: "FROM incidents x WHERE x.project_id = ? AND x.code <> 'WATCH_TRIGGERED'",
    time: "x.created_at", iso: false,
    describe: "x.title",
    fields: {
      area: { sql: "x.module", type: "text", label: "area", values: ["chatbot", "tests", "agents", "workflows", "uptime"] },
      code: { sql: "x.code", type: "text", label: "problem code" },
      severity: { sql: "x.severity", type: "text", label: "severity", values: ["low", "medium", "high"] },
      title: { sql: "x.title", type: "text", label: "title" },
    },
    alertModule: "workflows",
    examples: ["Alert me about any Google Sheet problem", "Tell me if more than 3 high problems open in a day"],
  },
};

const OPS = ["eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte"] as const;
export const WatchSpecSchema = z.object({
  /** each: every matching event. above / below: number of matching events in the window. */
  kind: z.enum(["each", "above", "below"]),
  filters: z.array(z.object({ field: z.string(), op: z.enum(OPS), value: z.union([z.string(), z.number(), z.boolean()]) })).max(6),
  threshold: z.number().min(0).max(100000).nullable().optional(),
  window_minutes: z.number().min(5).max(43200).nullable().optional(),
  severity: z.enum(["low", "medium", "high"]),
  /** One sentence: how ProofMyAI understood the prompt. */
  summary: z.string().max(300),
});
export type WatchSpec = z.infer<typeof WatchSpecSchema>;

export interface Watch {
  id: number; project_id: number; module: WatchModule; prompt: string; spec_json: string; enabled: number;
  created_at: string; last_checked_at: string | null; last_fired_at: string | null; fired_count: number;
}

const sqlTime = (d: Date, iso: boolean) => (iso ? d.toISOString() : d.toISOString().replace("T", " ").slice(0, 19));

/** Checks a spec only uses this module's fields and sensible values; returns a clean copy or an error. */
export function validateSpec(module: WatchModule, raw: unknown): { ok: true; spec: WatchSpec } | { ok: false; error: string } {
  const parsed = WatchSpecSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The watch couldn't be understood." };
  const spec = parsed.data;
  const src = SOURCES[module];
  for (const f of spec.filters) {
    const def = src.fields[f.field];
    if (!def) return { ok: false, error: `"${f.field}" isn't something ProofMyAI can watch for ${src.label}.` };
    if (def.type === "number" && typeof f.value !== "number") return { ok: false, error: `${def.label} needs a number.` };
    if (def.type === "bool") f.value = f.value === true || f.value === "true" || f.value === 1 ? 1 : 0;
    if (def.type !== "number" && ["gt", "gte", "lt", "lte"].includes(f.op)) return { ok: false, error: `${def.label} can't be compared with more/less than.` };
  }
  if (spec.kind !== "each") {
    if (spec.threshold == null || !spec.window_minutes) return { ok: false, error: "Say how many and over what time, e.g. \"more than 3 in an hour\"." };
  }
  if (spec.kind === "below" && (spec.threshold ?? 0) < 1) return { ok: false, error: "\"Fewer than 0\" can never happen." };
  return { ok: true, spec };
}

function whereClause(module: WatchModule, spec: WatchSpec): { sql: string; args: (string | number)[] } {
  const src = SOURCES[module];
  const parts: string[] = [];
  const args: (string | number)[] = [];
  for (const f of spec.filters) {
    const col = src.fields[f.field].sql; // allow-listed column expressions only; values are always parameters
    switch (f.op) {
      case "eq": parts.push(`lower(CAST(${col} AS TEXT)) = lower(?)`); args.push(String(f.value)); break;
      case "neq": parts.push(`(${col} IS NULL OR lower(CAST(${col} AS TEXT)) <> lower(?))`); args.push(String(f.value)); break;
      case "contains": parts.push(`instr(lower(COALESCE(${col}, '')), lower(?)) > 0`); args.push(String(f.value)); break;
      case "not_contains": parts.push(`instr(lower(COALESCE(${col}, '')), lower(?)) = 0`); args.push(String(f.value)); break;
      default: parts.push(`${col} ${{ gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op]} ?`); args.push(Number(f.value));
    }
  }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", args };
}

/** Matching events between two times (oldest first), with a short description of each. */
export function matches(projectId: number, module: WatchModule, spec: WatchSpec, from: Date, to: Date, limit = 5): { count: number; examples: string[] } {
  const src = SOURCES[module];
  const w = whereClause(module, spec);
  const range = ` AND ${src.time} > ? AND ${src.time} <= ?`;
  const args = [projectId, ...w.args, sqlTime(from, src.iso), sqlTime(to, src.iso)];
  const count = get<{ n: number }>(`SELECT COUNT(*) AS n ${src.from}${w.sql}${range}`, ...args)?.n ?? 0;
  const examples = count ? all<{ d: string }>(`SELECT ${src.describe} AS d ${src.from}${w.sql}${range} ORDER BY ${src.time} DESC LIMIT ?`, ...args, limit).map((r) => r.d) : [];
  return { count, examples };
}

/** How many times the watch would have alerted in the last `days` days (shown when it's created). */
export function backtest(projectId: number, module: WatchModule, spec: WatchSpec, now = new Date(), days = 7): number {
  const start = new Date(now.getTime() - days * 86400000);
  if (spec.kind === "each") return matches(projectId, module, spec, start, now, 0).count;
  const win = (spec.window_minutes ?? 60) * 60000;
  let fired = 0;
  for (let t = start.getTime() + win; t <= now.getTime(); t += win) {
    const n = matches(projectId, module, spec, new Date(t - win), new Date(t), 0).count;
    if (spec.kind === "above" ? n > (spec.threshold ?? 0) : n < (spec.threshold ?? 1)) fired++;
  }
  return fired;
}

export function addWatch(projectId: number, module: WatchModule, prompt: string, spec: WatchSpec, now = new Date()): number {
  return run("INSERT INTO watches (project_id, module, prompt, spec_json, created_at) VALUES (?, ?, ?, ?, ?)", projectId, module, prompt.slice(0, 500), JSON.stringify(spec), now.toISOString()).lastInsertRowid;
}

export function projectWatches(projectId: number, module?: WatchModule): (Watch & { spec: WatchSpec })[] {
  return all<Watch>(`SELECT * FROM watches WHERE project_id = ?${module ? " AND module = ?" : ""} ORDER BY id`, ...(module ? [projectId, module] : [projectId]))
    .map((w) => ({ ...w, spec: JSON.parse(w.spec_json) as WatchSpec }));
}

const QUIET_AFTER_MS = 6 * 3600000; // an "each" watch closes after 6 quiet hours, so it can alert again later
const lastRun = new Map<number, number>();

/**
 * Evaluates a project's watches. Called after new data arrives (at most every 20 seconds per project) and by the
 * 15-minute cron, so "fewer than…" and "nothing for…" watches fire even when no data arrives at all.
 */
export async function evaluateWatches(projectId: number, now = new Date(), opts: { force?: boolean } = {}): Promise<number> {
  const last = lastRun.get(projectId) ?? 0;
  if (!opts.force && now.getTime() - last < 20000) return 0;
  lastRun.set(projectId, now.getTime());
  let fired = 0;
  for (const w of projectWatches(projectId)) {
    if (!w.enabled) continue;
    try {
      fired += (await evaluateOne(w, now)) ? 1 : 0;
    } catch (err) {
      console.error(`[watches] watch ${w.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return fired;
}

async function evaluateOne(w: Watch & { spec: WatchSpec }, now: Date): Promise<boolean> {
  const { spec } = w;
  const src = SOURCES[w.module];
  const key = `watch:${w.id}`;
  const created = new Date(w.created_at);
  const title = `Your watch: ${w.prompt}`.slice(0, 200);
  let hit: { count: number; examples: string[] } | null = null;
  let detail = "";

  if (spec.kind === "each") {
    const since = w.last_checked_at ? new Date(w.last_checked_at) : created;
    const m = matches(w.project_id, w.module, spec, since, now);
    if (m.count) { hit = m; detail = `${m.count} new match${m.count === 1 ? "" : "es"} in ${src.label}.`; }
    else if (!w.last_fired_at || now.getTime() - Date.parse(w.last_fired_at) > QUIET_AFTER_MS) resolveIncidents(w.project_id, key);
  } else {
    const win = (spec.window_minutes ?? 60) * 60000;
    // A "fewer than" watch only judges a full window after it was created, so it never fires on day one by mistake.
    if (spec.kind === "below" && now.getTime() - created.getTime() < win) {
      run("UPDATE watches SET last_checked_at = ? WHERE id = ?", now.toISOString(), w.id);
      return false;
    }
    const m = matches(w.project_id, w.module, spec, new Date(now.getTime() - win), now);
    const breached = spec.kind === "above" ? m.count > (spec.threshold ?? 0) : m.count < (spec.threshold ?? 1);
    if (breached) {
      hit = m;
      detail = `${m.count} in the last ${windowLabel(spec.window_minutes ?? 60)} (you asked to be told when it's ${spec.kind === "above" ? "more than" : "fewer than"} ${spec.threshold}).`;
    } else resolveIncidents(w.project_id, key);
  }

  run("UPDATE watches SET last_checked_at = ? WHERE id = ?", now.toISOString(), w.id);
  if (!hit) return false;
  const opened = await raiseIncident(w.project_id, {
    module: src.alertModule, code: "WATCH_TRIGGERED", severity: spec.severity, title,
    detail: `${detail}${hit.examples.length ? ` Latest: ${hit.examples.slice(0, 3).join(" · ")}` : ""} ProofMyAI understood this watch as: ${spec.summary}`,
    dedupeKey: key,
  });
  run("UPDATE watches SET last_fired_at = ?, fired_count = fired_count + ? WHERE id = ?", now.toISOString(), opened ? 1 : 0, w.id);
  return opened;
}

export function windowLabel(min: number): string {
  if (min % 1440 === 0) return min === 1440 ? "day" : `${min / 1440} days`;
  if (min % 60 === 0) return min === 60 ? "hour" : `${min / 60} hours`;
  return `${min} minutes`;
}

/** Evaluates every non-demo project's watches (called by the cron). */
export async function evaluateAllWatches(now = new Date()): Promise<number> {
  const projects = all<{ id: number }>("SELECT DISTINCT w.project_id AS id FROM watches w JOIN projects p ON p.id = w.project_id WHERE w.enabled = 1 AND p.is_demo = 0");
  let fired = 0;
  for (const p of projects) fired += await evaluateWatches(p.id, now, { force: true });
  return fired;
}

const scheduled = new Set<number>();

/**
 * After new data arrives: check this project's watches in the background, never slowing the request. Bursts are
 * batched: at most one check every 20 seconds, and a burst always gets a final check once it's over.
 */
export function watchSoon(projectId: number): void {
  if (!get("SELECT 1 FROM watches WHERE project_id = ? AND enabled = 1 LIMIT 1", projectId)) return;
  const wait = Math.max(0, 20000 - (Date.now() - (lastRun.get(projectId) ?? 0)));
  if (wait === 0) {
    void evaluateWatches(projectId).catch((err) => console.error("[watches] failed:", err));
    return;
  }
  if (scheduled.has(projectId)) return;
  scheduled.add(projectId);
  setTimeout(() => {
    scheduled.delete(projectId);
    void evaluateWatches(projectId).catch((err) => console.error("[watches] failed:", err));
  }, wait + 50).unref?.();
}
