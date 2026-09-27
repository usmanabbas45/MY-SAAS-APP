import { all, get, run, transaction } from "../db";
import { raiseIncident, resolveIncidents } from "../incidents";
import { JudgeError, llmAvailable, llmGradeTest } from "../judge/llm";
import { decrypt, safeFetch } from "../security";
import { coverage, truncate } from "../text";

export interface Target {
  id: number;
  project_id: number;
  name: string;
  url: string;
  headers_enc: string | null;
  body_template: string;
  response_path: string;
}

export interface TestCase {
  id: number;
  question: string;
  expected: string;
  must_not: string;
}

/** Inserts the question into the JSON body template, escaping it safely. */
export function renderBody(template: string, question: string): string {
  const escaped = JSON.stringify(question).slice(1, -1);
  const body = template.replaceAll("{{question}}", escaped);
  JSON.parse(body); // throws if the template is not valid JSON
  return body;
}

/** Reads a value by dot path, e.g. "choices.0.message.content". Empty path returns the whole body. */
export function readPath(data: unknown, path: string): unknown {
  if (!path.trim()) return data;
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) return cur[Number(key)];
    return (cur as Record<string, unknown>)[key];
  }, data);
}

export async function askBot(target: Target, question: string): Promise<string> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (target.headers_enc) Object.assign(headers, JSON.parse(decrypt(target.headers_enc)) as Record<string, string>);
  const res = await safeFetch(target.url, { method: "POST", headers, body: renderBody(target.body_template, question) }, 60000);
  const raw = await res.text();
  if (!res.ok) throw new Error(`Bot returned HTTP ${res.status}: ${truncate(raw, 200)}`);
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw; // plain-text bots
  }
  const value = readPath(data, target.response_path);
  if (value == null) throw new Error(`Response has no value at "${target.response_path}". Body: ${truncate(raw, 200)}`);
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Rule-based grading used without an API key: expected facts must be covered and forbidden phrases absent. */
export function basicGradeTest(expected: string, mustNot: string, answer: string): { pass: boolean; reason: string } {
  const lower = answer.toLowerCase();
  const forbidden = mustNot.split(/\n|;/).map((s) => s.trim()).filter(Boolean).find((p) => lower.includes(p.toLowerCase()));
  if (forbidden) return { pass: false, reason: `The answer contains a forbidden statement: "${forbidden}".` };
  const facts = expected.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  const missing = facts.filter((f) => coverage(f, answer) < 0.6);
  if (missing.length) return { pass: false, reason: `Missing expected fact${missing.length > 1 ? "s" : ""}: ${missing.map((m) => `"${m}"`).join(", ")}.` };
  return { pass: true, reason: "All expected facts are present." };
}

export async function runSuite(targetId: number): Promise<{ runId: number; passed: number; failed: number }> {
  const target = get<Target>("SELECT * FROM bot_targets WHERE id = ?", targetId);
  if (!target) throw new Error("Bot target not found");
  const cases = all<TestCase>("SELECT id, question, expected, must_not FROM test_cases WHERE project_id = ? ORDER BY id", target.project_id);
  if (cases.length === 0) throw new Error("Add at least one test question first");

  const results: { c: TestCase; answer: string; pass: boolean; reason: string }[] = [];
  for (const c of cases) {
    try {
      const answer = await askBot(target, c.question);
      let grade: { pass: boolean; reason: string };
      try {
        grade = llmAvailable() ? await llmGradeTest(c.question, c.expected, c.must_not, answer) : basicGradeTest(c.expected, c.must_not, answer);
      } catch (err) {
        if (!(err instanceof JudgeError)) throw err;
        grade = basicGradeTest(c.expected, c.must_not, answer);
        grade.reason = `${grade.reason} (basic check - AI judge unavailable: ${err.message})`;
      }
      results.push({ c, answer, ...grade });
    } catch (err) {
      results.push({ c, answer: "", pass: false, reason: `Could not reach the bot: ${err instanceof Error ? err.message : "unknown error"}` });
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const runId = transaction(() => {
    const { lastInsertRowid } = run("INSERT INTO test_runs (project_id, target_id, passed, failed) VALUES (?, ?, ?, ?)", target.project_id, targetId, passed, failed);
    for (const r of results) {
      run("INSERT INTO test_results (run_id, case_id, question, answer, pass, reason) VALUES (?, ?, ?, ?, ?, ?)",
        lastInsertRowid, r.c.id, r.c.question, r.answer, r.pass ? 1 : 0, r.reason);
    }
    run("UPDATE bot_targets SET last_run_at = datetime('now') WHERE id = ?", targetId);
    return lastInsertRowid;
  });

  const dedupeKey = `tests:${targetId}`;
  if (failed > 0) {
    await raiseIncident(target.project_id, {
      module: "tests", code: "TESTS_FAILING", severity: failed / results.length >= 0.3 ? "high" : "medium",
      title: `${failed} of ${results.length} chatbot tests failing on "${target.name}"`,
      detail: results.filter((r) => !r.pass).slice(0, 3).map((r) => `• ${truncate(r.c.question, 80)}: ${r.reason}`).join("\n"),
      dedupeKey,
    });
  } else {
    resolveIncidents(target.project_id, dedupeKey);
  }
  return { runId, passed, failed };
}

/** Runs every target that has not run in the last 24 hours (called from the cron endpoint). */
export async function runDueSuites(): Promise<number> {
  const due = all<{ id: number }>(
    `SELECT t.id FROM bot_targets t
      WHERE (t.last_run_at IS NULL OR t.last_run_at <= datetime('now', '-24 hours'))
        AND EXISTS (SELECT 1 FROM test_cases c WHERE c.project_id = t.project_id)`,
  );
  let count = 0;
  for (const t of due) {
    try {
      await runSuite(t.id);
      count++;
    } catch (err) {
      console.error(`[cron] test suite ${t.id} failed:`, err);
    }
  }
  return count;
}
