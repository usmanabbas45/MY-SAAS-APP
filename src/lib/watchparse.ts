import { JudgeError, llmAvailable, llmTranslateWatch } from "./judge/llm";
import { SOURCES, validateSpec, windowLabel, type WatchModule, type WatchSpec } from "./watches";

type Filter = WatchSpec["filters"][number];

const OP_TEXT: Record<Filter["op"], string> = { eq: "is", neq: "is not", contains: "contains", not_contains: "doesn't contain", gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most" };

/** Plain-English description generated from the rule itself, so what the customer reads is exactly what runs. */
export function describeSpec(module: WatchModule, spec: WatchSpec): string {
  const src = SOURCES[module];
  const conds = spec.filters.map((f) => {
    const def = src.fields[f.field];
    if (def.type === "bool") return `${def.label}: ${f.value === 1 || f.value === true ? "yes" : "no"}`;
    return `${def.label} ${OP_TEXT[f.op]} ${typeof f.value === "string" ? `“${f.value}”` : f.value}`;
  });
  const what = `${src.label}${conds.length ? ` where ${conds.join(" and ")}` : ""}`;
  const sev = spec.severity === "high" ? " (high priority)" : spec.severity === "low" ? " (low priority)" : "";
  if (spec.kind === "each") return `Alert on every one of the ${what}${sev}.`;
  const win = windowLabel(spec.window_minutes ?? 60);
  if (spec.kind === "below" && spec.threshold === 1) return `Alert if there are no ${what} in a ${win}${sev}.`;
  return `Alert if there are ${spec.kind === "above" ? "more than" : "fewer than"} ${spec.threshold} ${what} in a ${win}${sev}.`;
}

const UNIT_MIN: Record<string, number> = { minute: 1, min: 1, mins: 1, minutes: 1, hour: 60, hr: 60, hrs: 60, hours: 60, day: 1440, days: 1440, week: 10080, weeks: 10080 };

function windowOf(p: string): number | null {
  if (/\b(daily|per day|a day|each day|every day|in a day|in one day)\b/.test(p)) return 1440;
  if (/\b(hourly|per hour|an hour|each hour|every hour|in an hour)\b/.test(p)) return 60;
  if (/\b(weekly|per week|a week|in a week)\b/.test(p)) return 10080;
  const m = p.match(/\b(?:in|within|for|over|during)\s+(?:the\s+)?(?:last\s+|past\s+)?(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/);
  return m ? Number(m[1]) * UNIT_MIN[m[2]] : null;
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

/**
 * Built-in parser used when no AI is configured (or the AI's answer isn't usable). It recognises the common ways
 * people phrase a watch; anything it can't understand is refused with an example rather than guessed.
 */
export function parseWatchPrompt(module: WatchModule, prompt: string): WatchSpec | null {
  const raw = prompt.trim();
  const p = raw.toLowerCase().replace(/[’']/g, "'");
  const filters: Filter[] = [];
  const add = (field: string, op: Filter["op"], value: string | number | boolean) => { if (SOURCES[module].fields[field] && !filters.some((f) => f.field === field)) filters.push({ field, op, value }); };
  const quoted = [...raw.matchAll(/["“”']([^"“”']{2,60})["“”']/g)].map((m) => m[1].trim());
  // "the Order sync workflow", "my Lead import scenario", or a capitalised name right before the noun.
  const GENERIC = /^(any|every|each|a|an|my|our|this|that|one|all|some|the)$/i;
  const afterThe = raw.match(/\b(?:the|my|our)\s+([\w&.'-]+(?:\s+[\w&.'-]+){0,3}?)\s+(?:workflow|scenario|agent|monitor|crm)\b/i);
  const capital = raw.match(/\b((?:[A-Z][\w&.-]*\s+){1,4})(?:workflow|scenario|agent|monitor|crm)\b/);
  const candidate = (afterThe?.[1] ?? capital?.[1])?.trim();
  const name = quoted[0] ?? (candidate && !GENERIC.test(candidate) ? candidate : undefined);
  let usedNumber = false;

  // ---- field conditions ----
  const money = p.match(new RegExp(String.raw`(?:costs?|spends?|cost of)?\s*(?:more than|over|above|exceeds?|>)\s*[$£€]\s?${NUM}|[$£€]\s?${NUM}`));
  if (money && (module === "agents")) { add("cost_usd", "gt", Number(money[1] ?? money[2])); usedNumber = true; }
  const secs = p.match(new RegExp(String.raw`(?:longer than|more than|over|slower than|above)\s+${NUM}\s*(ms|milliseconds?|s|secs?|seconds?|minutes?|mins?)\b`));
  if (secs) {
    const ms = Number(secs[1]) * (/^ms|milli/.test(secs[2]) ? 1 : /^min/.test(secs[2]) ? 60000 : 1000);
    add(module === "chatbot" || module === "uptime" ? "response_ms" : "duration_ms", "gt", ms);
    usedNumber = true;
  }
  const steps = p.match(new RegExp(String.raw`(?:more than|over|above)\s+${NUM}\s+steps`));
  if (steps) { add("steps", "gt", Number(steps[1])); usedNumber = true; }
  if (/\b(0|zero|no)\s+items\b|returns? nothing|produces? nothing|empty output|no output/.test(p)) add("output_items", "eq", 0);
  if (module === "approvals") {
    const amt = p.match(new RegExp(String.raw`(?:over|above|more than|greater than|bigger than|>)\s*[$£€]?\s?${NUM}`));
    if (amt && !windowOf(p)) { add("amount", "gt", Number(amt[1])); usedNumber = true; }
    for (const a of ["refund", "payment", "pay", "email", "discount", "cancel"]) if (new RegExp(`\\b${a}s?\\b`).test(p)) { add("action", "contains", a === "payment" ? "pay" : a); break; }
    if (/\breject/.test(p)) add("status", "eq", "rejected");
    if (/\bpending|waiting\b/.test(p)) add("status", "eq", "pending");
  }

  // ---- status / quality words ----
  if (/\b(fail|fails|failed|failing|errors?|crash(?:es|ed)?)\b/.test(p)) add("status", "eq", "error");
  if (module === "uptime" && /\b(down|offline|unreachable)\b/.test(p)) add("up", "eq", false);
  if (module === "chatbot") {
    if (/made[- ]up|hallucinat|invent/.test(p)) add("verdict", "eq", "hallucination");
    else if (/off[- ]policy|against (our|my|the) policy|breaks? (our|my|the)? ?polic/.test(p)) add("verdict", "eq", "off_policy");
    else if (/should (have )?escalat|hand ?over|didn'?t escalate|missed escalation/.test(p)) add("verdict", "eq", "should_escalate");
    else if (/not in (the |our )?docs|unsupported/.test(p)) add("verdict", "eq", "unsupported");
    else if (/\b(wrong|incorrect|bad|problem)\b/.test(p)) add("verdict", "neq", "correct");
    const says = raw.match(/\b(?:mentions?|says?|contains?|uses? the word|promises?)\s+(?:["“']([^"”']+)["”']|(?:a |an |the )?([\w£$€%-]+(?:\s[\w£$€%-]+)?))/i);
    if (says && !/made|up/.test((says[1] ?? says[2] ?? "").toLowerCase())) add("answer", "contains", (says[1] ?? says[2]).trim());
    const about = raw.match(/\b(?:asks? about|questions? about|about)\s+(?:["“']([^"”']+)["”']|([\w-]+(?:\s[\w-]+)?))/i);
    if (about && !filters.some((f) => f.field === "answer")) add("question", "contains", (about[1] ?? about[2]).trim());
  }
  if (module === "crm") {
    if (/no email|without (an )?email|missing email/.test(p)) add("has_email", "eq", false);
    if (/no owner|without (an )?owner|unassigned|missing owner/.test(p)) add("has_owner", "eq", false);
    if (/no phone|without (a )?phone|missing phone/.test(p)) add("has_phone", "eq", false);
  }
  if (module === "incidents") {
    if (/sheet/.test(p)) add("title", "contains", "sheet");
    else if (/heartbeat|scheduled job|cron|didn'?t run/.test(p)) add("code", "contains", "HEARTBEAT");
    else if (/\bcrm|lead/.test(p)) add("code", "contains", "CRM");
    if (/\bhigh\b|critical|urgent/.test(p)) add("severity", "eq", "high");
  }

  // ---- names ----
  if (name) {
    const field = { workflows: "workflow_name", agents: "agent_name", uptime: "monitor", crm: "crm", approvals: "agent_name", chatbot: "", incidents: "title" }[module];
    if (field && !filters.some((f) => f.field === field && f.op === "contains")) add(field, "contains", name);
  }

  // ---- how often ----
  const win = windowOf(p);
  let kind: WatchSpec["kind"] = "each";
  let threshold: number | null = null;
  if (/\b(hasn'?t|has not|haven'?t|didn'?t|doesn'?t|stops?|stopped|no new|nothing|no runs?|not run)\b/.test(p) && win && !filters.some((f) => f.field === "output_items")) {
    kind = "below"; threshold = 1;
  } else if (win) {
    const fewer = p.match(new RegExp(String.raw`(?:fewer than|less than|under|below)\s+${NUM}`));
    const more = p.match(new RegExp(String.raw`(?:more than|over|above|at least)\s+${NUM}(?!\s*(?:ms|s\b|secs?|seconds?|steps|minutes?))`));
    const times = p.match(new RegExp(String.raw`\b${NUM}\s+times\b|\b(twice|three times)\b`));
    if (fewer && !usedNumber) { kind = "below"; threshold = Number(fewer[1]); }
    else if (more && !usedNumber) { kind = "above"; threshold = Number(more[1]) - (/at least/.test(more[0]) ? 1 : 0); }
    else if (times) { kind = "above"; threshold = (times[2] === "twice" ? 2 : times[2] ? 3 : Number(times[1])) - 1; }
  }
  if (kind === "each" && !filters.length) return null; // "alert me about everything" would only be noise
  const severity: WatchSpec["severity"] = /urgent|critical|immediately|asap|right away/.test(p) || kind === "below" ? "high" : /low priority|fyi|just let me know/.test(p) ? "low" : "medium";
  const spec: WatchSpec = { kind, filters, threshold, window_minutes: kind === "each" ? null : win, severity, summary: "" };
  const v = validateSpec(module, spec);
  if (!v.ok) return null;
  return { ...v.spec, summary: describeSpec(module, v.spec) };
}

/** Prompt → rule: the AI when available (better with unusual wording), the built-in parser otherwise. */
export async function translateWatch(projectId: number, module: WatchModule, prompt: string): Promise<{ ok: true; spec: WatchSpec; by: "ai" | "rules" } | { ok: false; error: string }> {
  if (llmAvailable()) {
    try {
      const src = SOURCES[module];
      const fields = Object.entries(src.fields).map(([k, d]) => `${k} (${d.type}${d.values ? `: ${d.values.join(" | ")}` : ""}): ${d.label}`).join("\n");
      const out = await llmTranslateWatch(prompt, src.label, fields, { projectId, kind: "live" });
      const typed = {
        ...out,
        filters: out.filters.map((f) => ({ ...f, value: src.fields[f.field]?.type === "number" ? Number(f.value) : src.fields[f.field]?.type === "bool" ? /^(true|yes|1)$/i.test(f.value) : f.value })),
      };
      const v = validateSpec(module, typed);
      if (v.ok && (v.spec.kind !== "each" || v.spec.filters.length)) return { ok: true, spec: { ...v.spec, summary: describeSpec(module, v.spec) }, by: "ai" };
    } catch (err) {
      if (!(err instanceof JudgeError)) console.error("[watches] AI translation failed:", err);
    }
  }
  const spec = parseWatchPrompt(module, prompt);
  if (spec) return { ok: true, spec, by: "rules" };
  return { ok: false, error: `ProofMyAI couldn't turn that into a watch. Try something like: “${SOURCES[module].examples[0]}”.` };
}
