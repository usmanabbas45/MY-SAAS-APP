import { withConversationChecks } from "../audit/run";
import { get, run } from "../db";
import { buildKbIndex } from "../judge/features";
import { heuristicGrade } from "../judge/heuristic";
import { judgeConcurrency, judgeLabel, llmAvailable, llmGradeConversation } from "../judge/llm";
import type { Verdict } from "../judge/types";
import { BENCH_CASES, BENCH_DOCS, BENCH_VERSION, type BenchCase } from "./dataset";

/**
 * Runs the public benchmark through the same pipeline customers get (the judge plus conversation and safety
 * checks; no customer rules) and scores it. The headline question is "did it flag the answers that were
 * wrong, without flagging the right ones?"; exact verdict accuracy is reported too.
 */
export type BenchMode = "ai" | "basic";

export interface BenchResult { id: string; expected: Verdict; got: Verdict; reason: string }

export interface BenchMetrics {
  total: number;
  /** Wrong answers flagged as a problem / all wrong answers. */
  recall: number;
  /** Flags that were real problems / all flags. */
  precision: number;
  /** Correct answers wrongly flagged / all correct answers. */
  falseAlarmRate: number;
  /** Same verdict as the human label. */
  verdictAccuracy: number;
  byExpected: Record<string, { total: number; flagged: number; exact: number }>;
}

export interface BenchRun { mode: BenchMode; judge: string; version: string; metrics: BenchMetrics; results: BenchResult[]; createdAt: string }

/** Metrics for the hard cases only (subtle, multi-turn, trick questions). */
export function hardMetrics(r: BenchRun): BenchMetrics | null {
  const hard = new Set(BENCH_CASES.filter((c) => c.level === "hard").map((c) => c.id));
  const rows = r.results.filter((x) => hard.has(x.id));
  return rows.length ? score(rows) : null;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function score(results: BenchResult[]): BenchMetrics {
  const problem = (v: Verdict) => v !== "correct";
  const wrong = results.filter((r) => problem(r.expected));
  const right = results.filter((r) => !problem(r.expected));
  const flagged = results.filter((r) => problem(r.got));
  const byExpected: BenchMetrics["byExpected"] = {};
  for (const r of results) {
    const b = (byExpected[r.expected] ??= { total: 0, flagged: 0, exact: 0 });
    b.total++;
    if (problem(r.got)) b.flagged++;
    if (r.got === r.expected) b.exact++;
  }
  return {
    total: results.length,
    recall: pct(wrong.filter((r) => problem(r.got)).length, wrong.length),
    precision: pct(flagged.filter((r) => problem(r.expected)).length, flagged.length),
    falseAlarmRate: pct(right.filter((r) => problem(r.got)).length, right.length),
    verdictAccuracy: pct(results.filter((r) => r.got === r.expected).length, results.length),
    byExpected,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function runBenchmark(mode: BenchMode, cases: BenchCase[] = BENCH_CASES): Promise<BenchRun> {
  if (mode === "ai" && !llmAvailable()) throw new Error("No AI judge is configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY).");
  const index = buildKbIndex(BENCH_DOCS);
  const results = await mapLimit(cases, mode === "ai" ? judgeConcurrency() : 8, async (bc): Promise<BenchResult> => {
    const e = { conversationId: `bench-${bc.id}`, turnIndex: 1, question: bc.question, answer: bc.answer, ...(bc.context ? { context: bc.context } : {}) };
    const raw = mode === "ai" ? (await llmGradeConversation([e], BENCH_DOCS))[0] : heuristicGrade(e, index);
    const { grade } = withConversationChecks(e, raw);
    return { id: bc.id, expected: bc.expected, got: grade.verdict, reason: grade.reason };
  });
  return { mode, judge: mode === "ai" ? judgeLabel() : "Basic mode (rule-based, no AI)", version: BENCH_VERSION, metrics: score(results), results, createdAt: new Date().toISOString() };
}

export function saveBenchmark(r: BenchRun): void {
  run("INSERT INTO benchmark_runs (mode, judge, version, metrics_json, results_json) VALUES (?, ?, ?, ?, ?)", r.mode, r.judge, r.version, JSON.stringify(r.metrics), JSON.stringify(r.results));
}

export function latestBenchmark(mode: BenchMode): BenchRun | null {
  const row = get<{ mode: BenchMode; judge: string; version: string; metrics_json: string; results_json: string; created_at: string }>(
    "SELECT * FROM benchmark_runs WHERE mode = ? ORDER BY id DESC LIMIT 1", mode,
  );
  return row ? { mode: row.mode, judge: row.judge, version: row.version, metrics: JSON.parse(row.metrics_json), results: JSON.parse(row.results_json), createdAt: row.created_at } : null;
}
