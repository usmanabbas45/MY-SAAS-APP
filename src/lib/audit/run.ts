import { all, get, run, transaction } from "../db";
import { buildKbIndex, featureVector, signalsFor } from "../judge/features";
import { heuristicGrade } from "../judge/heuristic";
import { JudgeError, llmAvailable, llmGradeConversation } from "../judge/llm";
import { exchangesOf, type Conversation, type Grade, type KbDoc, type Severity, type Verdict } from "../judge/types";
import { loadModel, riskScore } from "../ml/risk";
import { raiseIncident } from "../incidents";

const SEVERITY_WEIGHT: Record<Severity, number> = { none: 0, low: 0.3, medium: 0.6, high: 1 };
const CONCURRENCY = 4;

export function scoreFromSeverities(severities: Severity[]): number {
  if (severities.length === 0) return 100;
  const penalty = severities.reduce((s, sev) => s + SEVERITY_WEIGHT[sev], 0);
  return Math.round((1 - penalty / severities.length) * 1000) / 10;
}

export function kbDocs(projectId: number): KbDoc[] {
  return all<KbDoc>("SELECT title, content FROM kb_docs WHERE project_id = ? ORDER BY id", projectId);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export function createAudit(projectId: number, name: string): { id: number; mode: "ai" | "basic" } {
  const mode = llmAvailable() ? "ai" : "basic";
  const { lastInsertRowid } = run("INSERT INTO audits (project_id, name, mode, status) VALUES (?, ?, ?, 'running')", projectId, name, mode);
  return { id: lastInsertRowid, mode };
}

/** Grades every chatbot reply in the conversations and stores the results. Never throws; failures are stored on the audit. */
export async function executeAudit(auditId: number, projectId: number, conversations: Conversation[]): Promise<void> {
  try {
    const audit = get<{ mode: string }>("SELECT mode FROM audits WHERE id = ?", auditId);
    if (!audit) return;
    const docs = kbDocs(projectId);
    const index = buildKbIndex(docs);
    const model = loadModel(projectId);

    const graded = await mapLimit(conversations, CONCURRENCY, async (conv) => {
      const exchanges = exchangesOf(conv);
      const grades: Grade[] =
        audit.mode === "ai" ? await llmGradeConversation(exchanges, docs) : exchanges.map((e) => heuristicGrade(e, index));
      return exchanges.map((e, i) => ({ e, g: grades[i] }));
    });

    const severities: Severity[] = [];
    transaction(() => {
      for (const { e, g } of graded.flat()) {
        const features = featureVector(signalsFor(e, index), g.verdict, g.confidence);
        severities.push(g.severity);
        run(
          `INSERT INTO audit_items (audit_id, conversation_id, turn_index, question, answer, verdict, severity, reason, source_doc, confidence, features_json, risk)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          auditId, e.conversationId, e.turnIndex, e.question, e.answer, g.verdict, g.severity, g.reason, g.sourceDoc,
          g.confidence, JSON.stringify(features), riskScore(model, features, g.verdict, g.confidence),
        );
      }
      run("UPDATE audits SET status = 'done', score = ? WHERE id = ?", scoreFromSeverities(severities), auditId);
    });

    const high = severities.filter((s) => s === "high").length;
    if (high > 0) {
      await raiseIncident(projectId, {
        module: "chatbot", code: "HIGH_SEVERITY_ANSWERS", severity: "high",
        title: `${high} high-risk chatbot answer${high > 1 ? "s" : ""} found`,
        detail: `Audit #${auditId} found ${high} answers that could cost money, customers or create legal exposure.`,
        dedupeKey: `audit:${auditId}`,
      });
    }
  } catch (err) {
    const message = err instanceof JudgeError || err instanceof Error ? err.message : "Unknown error";
    run("UPDATE audits SET status = 'failed', error = ? WHERE id = ?", message, auditId);
  }
}

export interface FixGroup {
  doc: string;
  count: number;
  high: number;
  verdicts: Partial<Record<Verdict, number>>;
  examples: { question: string; reason: string }[];
}

/** Groups problem answers by the help article that should be fixed or written. */
export function fixList(auditId: number): FixGroup[] {
  const rows = all<{ source_doc: string | null; verdict: Verdict; severity: Severity; question: string; reason: string }>(
    `SELECT source_doc, COALESCE(corrected_verdict, verdict) AS verdict, severity, question, reason
       FROM audit_items WHERE audit_id = ? AND COALESCE(corrected_verdict, verdict) <> 'correct'
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
    auditId,
  );
  const groups = new Map<string, FixGroup>();
  for (const r of rows) {
    const doc = r.source_doc ?? "Missing documentation (write a new article)";
    const g = groups.get(doc) ?? { doc, count: 0, high: 0, verdicts: {}, examples: [] };
    g.count++;
    if (r.severity === "high") g.high++;
    g.verdicts[r.verdict] = (g.verdicts[r.verdict] ?? 0) + 1;
    if (g.examples.length < 3) g.examples.push({ question: r.question, reason: r.reason });
    groups.set(doc, g);
  }
  return [...groups.values()].sort((a, b) => b.high - a.high || b.count - a.count);
}
