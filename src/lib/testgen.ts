import { kbDocs, NOT_STORED } from "./audit/run";
import { billingEnabled, billingState } from "./billing";
import { all, get, run, transaction } from "./db";
import { aiForProject, llmGenerateTests, type FailedQuestion } from "./judge/llm";
import { projectRules, RULE_KINDS } from "./rules";

/**
 * Auto test generator: writes nightly test questions for a chatbot from its help articles, the business's
 * rules and the questions it already got wrong. Results are suggestions; the customer adds them with one
 * click, so a badly worded test never causes false alerts. Runs on demand, and weekly for paid projects
 * whose help articles or failures changed.
 */
export interface TestSuggestion { id: number; question: string; expected: string; must_not: string; source: "failure" | "docs" | "safety"; why: string; created_at: string }

export const BATCH = 10;
const MAX_PENDING = 40;
const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Recent wrong answers with their text (results-only projects have none). */
export function recentFailures(projectId: number, limit = 30): FailedQuestion[] {
  const rows = all<{ question: string; answer: string; reason: string }>(
    `SELECT i.question, i.answer, i.reason FROM audit_items i JOIN audits a ON a.id = i.audit_id
      WHERE a.project_id = ? AND COALESCE(i.corrected_verdict, i.verdict) <> 'correct' AND i.question <> ?
      ORDER BY CASE i.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.id DESC LIMIT ?`,
    projectId, NOT_STORED, limit * 2,
  );
  const seen = new Set<string>();
  return rows.filter((r) => r.question.trim() && !seen.has(norm(r.question)) && seen.add(norm(r.question))).slice(0, limit);
}

export function pendingSuggestions(projectId: number): TestSuggestion[] {
  return all<TestSuggestion>("SELECT * FROM test_suggestions WHERE project_id = ? ORDER BY CASE source WHEN 'failure' THEN 0 WHEN 'safety' THEN 2 ELSE 1 END, id", projectId);
}

/** Asks the AI for new tests and stores them as suggestions. Returns how many were added. */
export async function generateTestSuggestions(projectId: number, count = BATCH): Promise<number> {
  if (!aiForProject(projectId)) throw new Error("The test generator needs AI checking switched on for this project (Settings → Data & privacy).");
  const docs = kbDocs(projectId);
  const failures = recentFailures(projectId);
  if (docs.length === 0 && failures.length === 0) throw new Error("Add your help articles on the Chatbot audits page first, so the generator knows the right answers.");
  const existing = [
    ...all<{ question: string }>("SELECT question FROM test_cases WHERE project_id = ?", projectId),
    ...all<{ question: string }>("SELECT question FROM test_suggestions WHERE project_id = ?", projectId),
  ].map((r) => r.question);
  const rules = projectRules(projectId).map((r) => `${RULE_KINDS[r.kind].label}: ${r.pattern}`);
  const out = await llmGenerateTests(docs, failures, rules, existing, count, { projectId, kind: "fix" });

  const seen = new Set(existing.map(norm));
  const fresh = out.tests.filter((t) => {
    const k = norm(t.question);
    if (!k || seen.has(k) || !t.must_include.some((f) => f.trim())) return false;
    seen.add(k);
    return true;
  });
  const room = Math.max(0, MAX_PENDING - (get<{ n: number }>("SELECT COUNT(*) AS n FROM test_suggestions WHERE project_id = ?", projectId)?.n ?? 0));
  const keep = fresh.slice(0, room);
  transaction(() => {
    for (const t of keep) {
      run(
        "INSERT INTO test_suggestions (project_id, question, expected, must_not, source, why) VALUES (?, ?, ?, ?, ?, ?)",
        projectId, t.question.trim().slice(0, 2000), t.must_include.map((f) => f.trim()).filter(Boolean).join("\n").slice(0, 4000),
        t.must_not.map((f) => f.trim()).filter(Boolean).join("\n").slice(0, 4000), t.source, t.why.slice(0, 300),
      );
    }
    run("UPDATE projects SET tests_generated_at = ? WHERE id = ?", new Date().toISOString(), projectId);
    // Counted with Fix with AI towards the Free plan's monthly AI allowance.
    run("INSERT INTO ai_fixes (project_id, kind, target, title, output) VALUES (?, 'tests', 'tests', 'Generated test questions', ?)", projectId, String(keep.length));
  });
  return keep.length;
}

/** Adds suggestions to the project's tests (all of them when ids is null). Returns how many were added. */
export function acceptSuggestions(projectId: number, ids: number[] | null): number {
  const rows = pendingSuggestions(projectId).filter((s) => ids === null || ids.includes(s.id));
  transaction(() => {
    for (const s of rows) {
      run("INSERT INTO test_cases (project_id, question, expected, must_not) VALUES (?, ?, ?, ?)", projectId, s.question, s.expected, s.must_not);
      run("DELETE FROM test_suggestions WHERE id = ?", s.id);
    }
  });
  return rows.length;
}

export function dismissSuggestions(projectId: number, ids: number[] | null): number {
  if (ids === null) return run("DELETE FROM test_suggestions WHERE project_id = ?", projectId).changes;
  return ids.reduce((n, id) => n + run("DELETE FROM test_suggestions WHERE id = ? AND project_id = ?", id, projectId).changes, 0);
}

/**
 * Weekly, for paid projects with a connected bot: new suggestions when the help articles changed or new wrong
 * answers appeared since the last run (or the bot has no tests yet). Called from the cron; at most `limit` per run.
 */
export async function autoGenerateTests(now = new Date(), limit = 5): Promise<number> {
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const candidates = all<{ id: number; user_id: number; tests_generated_at: string | null }>(
    `SELECT p.id, p.user_id, p.tests_generated_at FROM projects p
      WHERE p.is_demo = 0 AND p.use_ai = 1 AND EXISTS (SELECT 1 FROM bot_targets b WHERE b.project_id = p.id)
        AND (p.tests_generated_at IS NULL OR p.tests_generated_at <= ?)
      ORDER BY p.tests_generated_at IS NOT NULL, p.tests_generated_at LIMIT 50`, weekAgo,
  );
  let done = 0;
  for (const p of candidates) {
    if (done >= limit) break;
    if (billingEnabled() && billingState(p.user_id).plan.id === "free") continue;
    const since = (p.tests_generated_at ?? "1970-01-01T00:00:00Z").replace("T", " ").slice(0, 19);
    const noTests = !get("SELECT 1 FROM test_cases WHERE project_id = ?", p.id);
    const kbChanged = Boolean(get("SELECT 1 FROM kb_docs WHERE project_id = ? AND updated_at > ?", p.id, since));
    const newFailures = Boolean(get(
      `SELECT 1 FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND COALESCE(i.corrected_verdict, i.verdict) <> 'correct'
         AND COALESCE(i.created_at, a.created_at) > ?`, p.id, since,
    ));
    if (!noTests && !kbChanged && !newFailures) continue;
    try {
      await generateTestSuggestions(p.id);
      done++;
    } catch (err) {
      run("UPDATE projects SET tests_generated_at = ? WHERE id = ?", now.toISOString(), p.id); // don't retry every 15 minutes
      console.error(`[testgen] project ${p.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return done;
}
