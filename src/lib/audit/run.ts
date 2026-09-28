import { all, get, run, transaction } from "../db";
import { buildKbIndex, featureVector, signalsFor, type KbIndex } from "../judge/features";
import { heuristicGrade } from "../judge/heuristic";
import { aiForProject, JudgeError, judgeConcurrency, judgeLabel, llmGradeConversation } from "../judge/llm";
import { exchangesOf, type Conversation, type Exchange, type Grade, type KbDoc, type Severity, type Verdict } from "../judge/types";
import type { MlpModel } from "../ml/mlp";
import { loadModel, riskScore } from "../ml/risk";
import { applyRules, projectRules, type Rule } from "../rules";
import { isFrustrated } from "../sentiment";
import { raiseIncident } from "../incidents";

const SEVERITY_WEIGHT: Record<Severity, number> = { none: 0, low: 0.3, medium: 0.6, high: 1 };

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
  const mode = aiForProject(projectId) ? "ai" : "basic";
  const { lastInsertRowid } = run("INSERT INTO audits (project_id, name, mode, status, judge) VALUES (?, ?, ?, 'running', ?)", projectId, name, mode, judgeLabel(projectId));
  return { id: lastInsertRowid, mode };
}

export const NOT_STORED = "(not stored: this project keeps results only)";

/**
 * Stores one graded answer: applies the business's custom rules, flags frustrated customers,
 * computes the neural risk score. Shared by uploaded audits and live tracking. Returns the final grade.
 */
export function storeGradedItem(auditId: number, e: Exchange, g: Grade, index: KbIndex, model: MlpModel | null, rules: Rule[], note = ""): Grade {
  const { grade, hit } = applyRules(e, g, rules);
  const features = featureVector(signalsFor(e, index), grade.verdict, grade.confidence);
  // "Don't store transcripts" mode: keep the verdict, reason and scores, but not the chat text itself.
  const frustrated = isFrustrated(e.question) ? 1 : 0;
  const storeText = get<{ s: number }>("SELECT p.store_text AS s FROM audits a JOIN projects p ON p.id = a.project_id WHERE a.id = ?", auditId)?.s ?? 1;
  if (!storeText) e = { ...e, question: NOT_STORED, answer: NOT_STORED };
  run(
    `INSERT INTO audit_items (audit_id, conversation_id, turn_index, question, answer, verdict, severity, reason, source_doc, confidence, features_json, risk, created_at, frustrated, rule_hit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
    auditId, e.conversationId, e.turnIndex, e.question, e.answer, grade.verdict, grade.severity, grade.reason + note, grade.sourceDoc,
    grade.confidence, JSON.stringify(features), riskScore(model, features, grade.verdict, grade.confidence),
    frustrated, hit,
  );
  return grade;
}

/** Grades every chatbot reply in the conversations and stores the results. Never throws; failures are stored on the audit. */
export async function executeAudit(auditId: number, projectId: number, conversations: Conversation[]): Promise<void> {
  try {
    const audit = get<{ mode: string }>("SELECT mode FROM audits WHERE id = ?", auditId);
    if (!audit) return;
    const docs = kbDocs(projectId);
    const index = buildKbIndex(docs);
    const model = loadModel(projectId);
    const rules = projectRules(projectId);

    const graded = await mapLimit(conversations, audit.mode === "ai" ? judgeConcurrency() : 8, async (conv) => {
      const exchanges = exchangesOf(conv);
      const grades: Grade[] =
        audit.mode === "ai" ? await llmGradeConversation(exchanges, docs) : exchanges.map((e) => heuristicGrade(e, index));
      return exchanges.map((e, i) => ({ e, g: grades[i] }));
    });

    const severities: Severity[] = [];
    transaction(() => {
      for (const { e, g } of graded.flat()) {
        severities.push(storeGradedItem(auditId, e, g, index, model, rules).severity);
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
