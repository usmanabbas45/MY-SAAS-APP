import type { AgentRun, AgentStep } from "./checks";

/**
 * OpenTelemetry (OTLP/HTTP JSON) traces → ProofMyAI agent runs. Works with any framework that emits the
 * OpenTelemetry GenAI conventions (gen_ai.*) or OpenInference (openinference.span.kind, input.value…):
 * LangChain/LangGraph, CrewAI, OpenAI Agents SDK, LlamaIndex, Vercel AI SDK and others. One trace = one run.
 */
type AnyValue = { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean; arrayValue?: { values?: AnyValue[] } };
interface KeyValue { key: string; value?: AnyValue }
export interface OtlpSpan {
  traceId?: string; spanId?: string; parentSpanId?: string; name?: string;
  startTimeUnixNano?: string | number; endTimeUnixNano?: string | number;
  status?: { code?: number | string; message?: string };
  attributes?: KeyValue[];
  events?: { name?: string; attributes?: KeyValue[] }[];
}
export interface OtlpTraces {
  resourceSpans?: { resource?: { attributes?: KeyValue[] }; scopeSpans?: { spans?: OtlpSpan[] }[] }[];
}

interface Span extends OtlpSpan { attrs: Record<string, unknown>; service: string }

const MAX_TEXT = 4000;

function val(v: AnyValue | undefined): unknown {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(val);
  return undefined;
}

const attrsOf = (kv: KeyValue[] | undefined) => Object.fromEntries((kv ?? []).map((a) => [a.key, val(a.value)]));
const str = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));
const clip = (v: unknown) => { const s = str(v); return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s; };
const nanos = (v: string | number | undefined) => (v == null ? 0 : Number(BigInt(String(v)) / 1000000n));
const isError = (s: OtlpSpan) => s.status?.code === 2 || s.status?.code === "STATUS_CODE_ERROR";

function first(a: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (a[k] != null && a[k] !== "") return a[k];
  return undefined;
}

function stepType(s: Span): AgentStep["type"] | null {
  const kind = str(s.attrs["openinference.span.kind"]).toUpperCase();
  const op = str(s.attrs["gen_ai.operation.name"]).toLowerCase();
  if (kind === "TOOL" || op === "execute_tool" || s.attrs["gen_ai.tool.name"] != null || s.attrs["tool.name"] != null) return "tool";
  if (kind === "RETRIEVER" || kind === "EMBEDDING" || op === "embeddings") return "retrieval";
  if (kind === "LLM" || ["chat", "text_completion", "generate_content"].includes(op) || s.attrs["gen_ai.request.model"] != null) return "llm";
  return null; // agent / chain / framework plumbing spans aren't steps
}

function errorOf(s: Span): string | null {
  if (!isError(s)) return null;
  const ex = (s.events ?? []).find((e) => e.name === "exception");
  const exAttrs = attrsOf(ex?.attributes);
  return clip(s.status?.message || exAttrs["exception.message"] || exAttrs["exception.type"] || "Span failed") || "Span failed";
}

function toStep(s: Span, type: AgentStep["type"]): AgentStep {
  const a = s.attrs;
  const tokens = Number(first(a, "llm.token_count.total") ?? 0) || (Number(a["gen_ai.usage.input_tokens"] ?? a["gen_ai.usage.prompt_tokens"] ?? 0) + Number(a["gen_ai.usage.output_tokens"] ?? a["gen_ai.usage.completion_tokens"] ?? 0));
  return {
    type,
    name: str(first(a, "gen_ai.tool.name", "tool.name", "gen_ai.request.model", "llm.model_name") ?? s.name).slice(0, 200) || (s.name ?? "").slice(0, 200),
    input: clip(first(a, "gen_ai.tool.call.arguments", "input.value", "gen_ai.prompt")) || undefined,
    output: clip(first(a, "gen_ai.tool.call.result", "output.value", "gen_ai.completion")) || undefined,
    error: errorOf(s),
    duration_ms: Math.max(0, nanos(s.endTimeUnixNano) - nanos(s.startTimeUnixNano)),
    tokens: Number.isFinite(tokens) ? tokens : 0,
    cost_usd: Number(first(a, "gen_ai.usage.cost", "llm.cost.total") ?? 0) || 0,
  };
}

/** Groups spans by trace. A trace becomes a run once its root span (no parent in the trace) has arrived. */
export function flattenSpans(body: OtlpTraces): Span[] {
  const out: Span[] = [];
  for (const rs of body.resourceSpans ?? []) {
    const service = str(attrsOf(rs.resource?.attributes)["service.name"]);
    for (const ss of rs.scopeSpans ?? []) for (const s of ss.spans ?? []) if (s.traceId && s.spanId) out.push({ ...s, attrs: attrsOf(s.attributes), service });
  }
  return out;
}

export function runFromTrace(spans: Span[]): AgentRun | null {
  const ids = new Set(spans.map((s) => s.spanId));
  const root = spans.find((s) => !s.parentSpanId || !ids.has(s.parentSpanId));
  if (!root || (root.parentSpanId && root.parentSpanId !== "" && !/^0+$/.test(root.parentSpanId))) return null;
  const ordered = [...spans].sort((a, b) => nanos(a.startTimeUnixNano) - nanos(b.startTimeUnixNano));
  const steps: AgentStep[] = [];
  for (const s of ordered) {
    if (s === root) continue;
    const type = stepType(s) ?? (isError(s) ? "other" : null);
    if (type) steps.push(toStep(s, type));
  }
  if (!steps.length && stepType(root)) steps.push(toStep(root, stepType(root)!));
  const a = root.attrs;
  const failed = isError(root);
  return {
    run_id: root.traceId!.slice(0, 200),
    agent_name: str(first(a, "gen_ai.agent.name", "agent.name") ?? root.service ?? root.name).slice(0, 200) || root.name?.slice(0, 200) || "agent",
    goal: clip(first(a, "input.value", "gen_ai.prompt", "gen_ai.agent.description")),
    status: failed ? "error" : "success",
    final_output: clip(first(a, "output.value", "gen_ai.completion")) || (failed ? "" : clip([...steps].reverse().find((s) => s.type === "llm")?.output)),
    steps: steps.slice(0, 2000),
  };
}

/** Child spans often arrive before their root span (each is exported when it ends), so they wait here briefly. */
const pending = new Map<string, { spans: Span[]; at: number }>();
const PENDING_MS = 10 * 60 * 1000;

/** Returns the runs completed by this export; spans of unfinished traces are kept until their root arrives. */
export function collectRuns(projectId: number, body: OtlpTraces, now = Date.now()): AgentRun[] {
  for (const [k, v] of pending) if (now - v.at > PENDING_MS) pending.delete(k);
  const byTrace = new Map<string, Span[]>();
  for (const s of flattenSpans(body)) {
    const key = `${projectId}:${s.traceId}`;
    if (!byTrace.has(key)) byTrace.set(key, [...(pending.get(key)?.spans ?? [])]);
    byTrace.get(key)!.push(s);
  }
  const runs: AgentRun[] = [];
  for (const [key, spans] of byTrace) {
    const r = runFromTrace(spans);
    if (r) {
      pending.delete(key);
      runs.push(r);
    } else if (spans.length < 5000) {
      pending.set(key, { spans, at: now });
    }
  }
  return runs;
}
