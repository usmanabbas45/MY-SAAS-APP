import { fixList, kbDocs, NOT_STORED, riskSummary } from "./audit/run";
import { billingState } from "./billing";
import { all, get, run } from "./db";
import { FLAG_LABELS, type ConvFlag } from "./judge/conversation";
import { aiForProject, llmFixArticle, llmSafeSystemPrompt } from "./judge/llm";
import { VERDICT_LABELS, type Verdict } from "./judge/types";
import { projectRules, RULE_KINDS } from "./rules";

/**
 * "Fix with AI": turns ProofMyAI's findings into ready-to-use fixes for the customer's existing bot:
 * a corrected help article for each fix-list group, and a hardened system prompt. Nothing is built or
 * hosted for them; they paste the result into their own bot (or save the article to ProofMyAI's
 * knowledge base so future checks use it).
 */
export type FixKind = "article" | "prompt";
export interface AiFix { id: number; project_id: number; audit_id: number | null; kind: FixKind; target: string; title: string | null; output: string; notes: string | null; applied_at: string | null; created_at: string }

/** Fixes per calendar month on the free plan (paid plans: unlimited, rate-limited per hour by the caller). */
export const FREE_FIXES_PER_MONTH = 3;
const MISSING = "Missing documentation (write a new article)";

/** Fix-list groups that describe bot behaviour (prompt, logic, hand-over) rather than a help article. */
export const isBehaviourGroup = (doc: string) => /^Bot [a-z /-]+:/i.test(doc);

export function fixAvailability(projectId: number, ownerId: number): string | null {
  if (!aiForProject(projectId)) return "Fix with AI needs AI checking switched on for this project (Settings → Data & privacy).";
  if (billingState(ownerId).plan.id !== "free") return null;
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const used = get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_fixes f JOIN projects p ON p.id = f.project_id WHERE p.user_id = ? AND f.created_at >= ?", ownerId, since.toISOString().replace("T", " ").slice(0, 19))?.n ?? 0;
  return used >= FREE_FIXES_PER_MONTH ? `The Free plan includes ${FREE_FIXES_PER_MONTH} AI fixes per month. Upgrade on the Billing page for unlimited fixes.` : null;
}

const rulesText = (projectId: number) => projectRules(projectId).map((r) => `${RULE_KINDS[r.kind].label}: ${r.pattern}`);

/** Writes the corrected help article for one fix-list group of an audit. */
export async function generateArticleFix(projectId: number, auditId: number, groupDoc: string): Promise<AiFix> {
  const group = fixList(auditId).find((g) => g.doc === groupDoc);
  if (!group) throw new Error("That fix-list item no longer exists. Reload the page.");
  const examples = group.examples.filter((e) => e.question !== NOT_STORED);
  if (!examples.length) throw new Error("This project keeps results only (no conversation text), so there are no examples to write a fix from.");
  const title = groupDoc === MISSING ? "New help article" : groupDoc;
  const existing = get<{ content: string }>("SELECT content FROM kb_docs WHERE project_id = ? AND title = ?", projectId, groupDoc);
  const r = await llmFixArticle(kbDocs(projectId), { title, content: existing?.content ?? null }, examples, rulesText(projectId), { projectId, kind: "fix" });
  const { lastInsertRowid } = run(
    "INSERT INTO ai_fixes (project_id, audit_id, kind, target, title, output, notes) VALUES (?, ?, 'article', ?, ?, ?, ?)",
    projectId, auditId, groupDoc, (r.title || title).slice(0, 200), r.article, JSON.stringify(r.changes.slice(0, 6)),
  );
  return get<AiFix>("SELECT * FROM ai_fixes WHERE id = ?", lastInsertRowid)!;
}

/** Summarises what went wrong across the project's audits, for the safe system prompt. */
export function findingsSummary(projectId: number): string[] {
  const audits = all<{ id: number }>("SELECT id FROM audits WHERE project_id = ? AND status IN ('done', 'live') ORDER BY id DESC LIMIT 5", projectId);
  const verdicts = new Map<Verdict, number>();
  const flags = new Map<ConvFlag, number>();
  const groups: string[] = [];
  for (const a of audits) {
    for (const r of all<{ verdict: Verdict; n: number }>("SELECT COALESCE(corrected_verdict, verdict) AS verdict, COUNT(*) AS n FROM audit_items WHERE audit_id = ? GROUP BY 1", a.id)) {
      if (r.verdict !== "correct") verdicts.set(r.verdict, (verdicts.get(r.verdict) ?? 0) + r.n);
    }
    for (const [f, n] of Object.entries(riskSummary(a.id).flags) as [ConvFlag, number][]) if (n) flags.set(f, (flags.get(f) ?? 0) + n);
    for (const g of fixList(a.id).slice(0, 4)) {
      const ex = g.examples.find((e) => e.question !== NOT_STORED);
      groups.push(`${g.doc} (${g.count} answers)${ex ? `: e.g. customer "${ex.question.slice(0, 160)}" → ${ex.reason.slice(0, 200)}` : ""}`);
    }
  }
  return [
    ...[...verdicts].map(([v, n]) => `${VERDICT_LABELS[v]}: ${n} answers`),
    ...[...flags].map(([f, n]) => `${FLAG_LABELS[f]}: ${n} times`),
    ...[...new Set(groups)].slice(0, 10),
  ];
}

export async function generateSafePrompt(projectId: number): Promise<AiFix> {
  const name = get<{ name: string }>("SELECT name FROM projects WHERE id = ?", projectId)?.name ?? "the business";
  const r = await llmSafeSystemPrompt(kbDocs(projectId), name, rulesText(projectId), findingsSummary(projectId), { projectId, kind: "fix" });
  const { lastInsertRowid } = run(
    "INSERT INTO ai_fixes (project_id, kind, target, title, output, notes) VALUES (?, 'prompt', 'system_prompt', 'Safe system prompt', ?, ?)",
    projectId, r.system_prompt, JSON.stringify(r.notes.slice(0, 6)),
  );
  return get<AiFix>("SELECT * FROM ai_fixes WHERE id = ?", lastInsertRowid)!;
}

/** Saves a generated article into ProofMyAI's knowledge base (replacing the article it fixes). */
export function applyArticleFix(projectId: number, fixId: number): { title: string } {
  const f = get<AiFix>("SELECT * FROM ai_fixes WHERE id = ? AND project_id = ? AND kind = 'article'", fixId, projectId);
  if (!f) throw new Error("Fix not found.");
  const title = (f.target === MISSING || isBehaviourGroup(f.target) ? f.title : f.target) || "Help article";
  const existing = get<{ id: number }>("SELECT id FROM kb_docs WHERE project_id = ? AND title = ?", projectId, title);
  if (existing) run("UPDATE kb_docs SET content = ?, updated_at = datetime('now') WHERE id = ?", f.output, existing.id);
  else run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, ?, ?)", projectId, title, f.output);
  run("UPDATE ai_fixes SET applied_at = datetime('now') WHERE id = ?", f.id);
  return { title };
}

/** Newest fix per target for an audit (article fixes), plus the newest safe prompt for the project. */
export function latestFixes(projectId: number, auditId: number | null): Map<string, AiFix> {
  const rows = auditId == null
    ? all<AiFix>("SELECT * FROM ai_fixes WHERE project_id = ? AND kind = 'prompt' ORDER BY id DESC LIMIT 1", projectId)
    : all<AiFix>("SELECT * FROM ai_fixes WHERE project_id = ? AND audit_id = ? ORDER BY id DESC", projectId, auditId);
  const out = new Map<string, AiFix>();
  for (const r of rows) if (!out.has(r.target)) out.set(r.target, r);
  return out;
}

export const fixNotes = (f: AiFix): string[] => { try { return JSON.parse(f.notes ?? "[]") as string[]; } catch { return []; } };
