import { all } from "./db";
import { raiseIncident, resolveIncidents } from "./incidents";
import { NOT_STORED } from "./audit/run";
import { topicFor } from "./topics";
import { wilsonLower } from "./trust";

/**
 * Silent regressions: quality that slips after a model, prompt, help-doc or tool change while nothing errors.
 * Compares the last 24 hours with the 7 days before, and only alerts when the drop is too big to be chance.
 */
const DAY = 86400000;
const sqlTime = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const pct = (x: number) => Math.round(x * 100);

/** Upper bound of the 95% Wilson interval: the best the recent accuracy could plausibly be. */
export function wilsonUpper(k: number, n: number): number {
  return n === 0 ? 1 : 1 - wilsonLower(n - k, n);
}

export async function chatbotQualityCheck(projectId: number, now = Date.now()): Promise<void> {
  const rows = all<{ v: string; at: string; topic: string | null; question: string; source_doc: string | null }>(
    `SELECT COALESCE(i.corrected_verdict, i.verdict) AS v, replace(COALESCE(i.created_at, a.created_at), 'T', ' ') AS at, i.topic, i.question, i.source_doc
       FROM audit_items i JOIN audits a ON a.id = i.audit_id
      WHERE a.project_id = ? AND a.status = 'live' AND replace(COALESCE(i.created_at, a.created_at), 'T', ' ') >= ?`,
    projectId, sqlTime(now - 8 * DAY),
  );
  const cut = sqlTime(now - DAY);
  const recent = rows.filter((r) => r.at >= cut);
  const base = rows.filter((r) => r.at < cut);
  const key = "quality:chatbot";
  if (recent.length < 20 || base.length < 50) return;
  const okRecent = recent.filter((r) => r.v === "correct").length;
  const accRecent = okRecent / recent.length;
  const accBase = base.filter((r) => r.v === "correct").length / base.length;
  if (accBase - accRecent >= 0.1 && wilsonUpper(okRecent, recent.length) < accBase) {
    const byTopic = new Map<string, number>();
    for (const r of recent) if (r.v !== "correct") {
      const t = r.topic || topicFor(r.question === NOT_STORED ? "" : r.question, r.source_doc);
      byTopic.set(t, (byTopic.get(t) ?? 0) + 1);
    }
    const top = [...byTopic.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} (${n})`).join(", ");
    await raiseIncident(projectId, {
      module: "chatbot", code: "QUALITY_DROP", severity: "high",
      title: `Chatbot accuracy dropped from ${pct(accBase)}% to ${pct(accRecent)}%`,
      detail: `${recent.length} answers in the last 24 hours vs ${base.length} in the week before. Most new mistakes: ${top}. Nothing errored, so this usually follows a change: a new AI model or prompt, edited help articles, or a new product or policy the bot doesn't know about.`,
      dedupeKey: key,
    });
  } else if (accRecent >= accBase - 0.05) {
    resolveIncidents(projectId, key);
  }
}

interface RunRow { agent_name: string; score: number; steps_json: string; at: string }
type ToolStat = { runs: number; calls: number; errors: number };

function toolStats(runs: RunRow[]): Map<string, ToolStat> {
  const m = new Map<string, ToolStat>();
  for (const r of runs) {
    let steps: { type?: string; name?: string; error?: string | null }[] = [];
    try { steps = JSON.parse(r.steps_json); } catch { continue; }
    const seen = new Set<string>();
    for (const s of steps) {
      if (s.type !== "tool" || !s.name) continue;
      const t = m.get(s.name) ?? { runs: 0, calls: 0, errors: 0 };
      t.calls++;
      if (s.error) t.errors++;
      if (!seen.has(s.name)) { t.runs++; seen.add(s.name); }
      m.set(s.name, t);
    }
  }
  return m;
}

/** Per agent: score drops, tools it stopped (or started) calling, and tools that started failing. */
export async function agentDriftCheck(projectId: number, now = Date.now()): Promise<void> {
  const rows = all<RunRow>(
    "SELECT agent_name, score, steps_json, replace(created_at, 'T', ' ') AS at FROM agent_runs WHERE project_id = ? AND replace(created_at, 'T', ' ') >= ?",
    projectId, sqlTime(now - 8 * DAY),
  );
  const cut = sqlTime(now - DAY);
  const agents = new Set(rows.map((r) => r.agent_name));
  for (const name of agents) {
    const recent = rows.filter((r) => r.agent_name === name && r.at >= cut);
    const base = rows.filter((r) => r.agent_name === name && r.at < cut);
    if (recent.length < 10 || base.length < 20) continue;

    const avg = (xs: RunRow[]) => xs.reduce((s, r) => s + r.score, 0) / xs.length;
    const qKey = `quality:agent:${name}`;
    const sRecent = avg(recent), sBase = avg(base);
    if (sBase - sRecent >= 15) {
      await raiseIncident(projectId, {
        module: "agents", code: "AGENT_QUALITY_DROP", severity: "high",
        title: `Agent "${name}" got worse: score ${Math.round(sBase)} → ${Math.round(sRecent)}`,
        detail: `Average run score over the last 24 hours (${recent.length} runs) vs the week before (${base.length} runs). Check what changed: the model, the prompt, a tool or an API it calls.`,
        dedupeKey: qKey,
      });
    } else if (sBase - sRecent < 8) resolveIncidents(projectId, qKey);

    const tb = toolStats(base), tr = toolStats(recent);
    const changes: string[] = [];
    for (const [tool, b] of tb) {
      const r = tr.get(tool) ?? { runs: 0, calls: 0, errors: 0 };
      if (b.runs / base.length >= 0.6 && r.runs / recent.length <= 0.1) changes.push(`stopped calling "${tool}" (was in ${pct(b.runs / base.length)}% of runs, now ${pct(r.runs / recent.length)}%)`);
      const errB = b.calls ? b.errors / b.calls : 0, errR = r.calls ? r.errors / r.calls : 0;
      if (r.calls >= 5 && errR >= 0.3 && errR - errB >= 0.25) changes.push(`"${tool}" now fails in ${pct(errR)}% of calls (was ${pct(errB)}%)`);
    }
    for (const [tool, r] of tr) {
      if (!tb.has(tool) && r.runs / recent.length >= 0.3) changes.push(`started calling a new tool "${tool}" (${pct(r.runs / recent.length)}% of runs)`);
    }
    const dKey = `drift:agent:${name}`;
    if (changes.length) {
      await raiseIncident(projectId, {
        module: "agents", code: "AGENT_BEHAVIOUR_CHANGED", severity: "medium",
        title: `Agent "${name}" is behaving differently`,
        detail: `In the last 24 hours it ${changes.join("; ")}. A change in how an agent uses its tools usually comes before wrong results: check recent model, prompt or API changes.`,
        dedupeKey: dKey,
      });
    } else resolveIncidents(projectId, dKey);
  }
}

export async function qualityChecks(projectId: number, now = Date.now()): Promise<void> {
  await chatbotQualityCheck(projectId, now);
  await agentDriftCheck(projectId, now);
}
