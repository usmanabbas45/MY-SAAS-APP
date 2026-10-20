import { z } from "zod";
import { json, readIngest } from "@/lib/api";
import { all } from "@/lib/db";
import { assertPublicUrl, rateLimit } from "@/lib/security";
import { runSuite } from "@/lib/tests/runner";

const TestRunSchema = z.object({
  /** Which saved bot to test (its name or id). Optional when the project has only one. */
  bot: z.union([z.string().min(1).max(200), z.number().int()]).optional(),
  /** Test a preview or staging deployment instead of the saved URL, e.g. from a pull request. */
  url: z.string().url().max(2000).optional(),
  /** Share of questions that must pass for `ok` to be true (default: all of them). */
  min_pass_rate: z.number().min(0).max(1).default(1),
});

/**
 * Regression tests for deploy pipelines: asks the bot every saved test question right now and answers with
 * pass/fail per question. A GitHub Action can fail the build when `ok` is false, so a prompt, model or
 * help-doc change that breaks answers never reaches customers. CI runs don't raise incidents.
 */
export async function POST(req: Request) {
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const parsed = TestRunSchema.safeParse(r.body ?? {});
  if (!parsed.success) {
    return json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  }
  if (!rateLimit(`test-runs:${r.project.id}`, 30, 3600000)) return json({ error: "Rate limit exceeded (30 test runs per hour)" }, 429);
  const { bot, url, min_pass_rate } = parsed.data;
  const targets = all<{ id: number; name: string }>("SELECT id, name FROM bot_targets WHERE project_id = ? ORDER BY id", r.project.id);
  const target = bot == null ? (targets.length === 1 ? targets[0] : null)
    : targets.find((t) => t.id === bot || t.name.toLowerCase() === String(bot).toLowerCase()) ?? null;
  if (!target) {
    return json({ error: targets.length ? `Say which bot to test with "bot": ${targets.map((t) => `"${t.name}"`).join(", ")}` : "Add your bot under Chatbot tests first" }, 400);
  }
  if (url) {
    try {
      await assertPublicUrl(url);
    } catch {
      return json({ error: "url must be a public http(s) address" }, 400);
    }
  }
  try {
    const { runId, passed, failed, results } = await runSuite(target.id, { url, ci: true });
    const total = passed + failed;
    const passRate = total ? passed / total : 0;
    return json({
      ok: total > 0 && passRate >= min_pass_rate,
      run_id: runId, bot: target.name, passed, failed, total, pass_rate: Math.round(passRate * 1000) / 1000,
      failures: results.filter((x) => !x.pass).map((x) => ({ question: x.question, answer: x.answer, reason: x.reason })),
    }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Test run failed" }, 400);
  }
}
