import { get, run } from "../db";
import { raiseIncident } from "../incidents";
import { JudgeError, llmAvailable, llmJudgeAgentRun } from "../judge/llm";
import { agentScore, AgentRunSchema, checkAgentRun, stepsLog, totals, type Issue } from "./checks";

interface ProjectLimits {
  agent_cost_budget_usd: number;
  agent_max_steps: number;
  agent_max_ms: number;
  agent_ai_review: number;
}

export type IngestResult = { ok: true; id: number; score: number; issues: Issue[] } | { ok: false; status: number; error: string };

export async function ingestAgentRun(projectId: number, body: unknown): Promise<IngestResult> {
  const parsed = AgentRunSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") };
  }
  const data = parsed.data;
  const p = get<ProjectLimits>(
    "SELECT agent_cost_budget_usd, agent_max_steps, agent_max_ms, agent_ai_review FROM projects WHERE id = ?", projectId,
  );
  if (!p) return { ok: false, status: 404, error: "Project not found" };

  const issues = checkAgentRun(data, { costBudgetUsd: p.agent_cost_budget_usd, maxSteps: p.agent_max_steps, maxMs: p.agent_max_ms });
  const score = agentScore(issues);
  const t = totals(data.steps);
  const existing = get("SELECT id FROM agent_runs WHERE project_id = ? AND external_id = ?", projectId, data.run_id);
  if (existing) return { ok: false, status: 409, error: `Run "${data.run_id}" was already recorded` };

  const { lastInsertRowid: id } = run(
    `INSERT INTO agent_runs (project_id, external_id, agent_name, goal, status, final_output, steps_json, total_cost_usd, total_ms, issues_json, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    projectId, data.run_id, data.agent_name, data.goal, data.status, data.final_output, JSON.stringify(data.steps),
    t.cost, t.ms, JSON.stringify(issues), score,
  );

  await alertOnIssues(projectId, data.agent_name, data.run_id, issues);

  // The AI review is slower; it runs after the response so the customer's agent is never blocked.
  if (p.agent_ai_review && llmAvailable() && data.goal.trim() && data.status === "success") {
    void aiReview(id, projectId, data.agent_name, data.run_id, data.goal, stepsLog(data.steps), data.final_output, issues);
  }
  return { ok: true, id, score, issues };
}

async function alertOnIssues(projectId: number, agent: string, runId: string, issues: Issue[]) {
  const high = issues.filter((i) => i.severity === "high");
  if (high.length === 0) return;
  await raiseIncident(projectId, {
    module: "agents", code: high[0].code, severity: "high",
    title: `Agent "${agent}": ${high.map((i) => i.code.replace(/_/g, " ").toLowerCase()).join(", ")}`,
    detail: `Run ${runId}: ${high.map((i) => i.message).join(" ")}`,
    dedupeKey: `agent:${agent}:${high[0].code}`,
  });
}

export async function aiReview(
  id: number, projectId: number, agent: string, runId: string, goal: string, log: string, output: string, issues: Issue[],
): Promise<void> {
  try {
    const verdict = await llmJudgeAgentRun(goal, log, output);
    const extra: Issue[] = [];
    if (!verdict.goal_achieved) extra.push({ code: "GOAL_NOT_MET", severity: "high", message: `AI review: ${verdict.reason}` });
    if (!verdict.grounded) extra.push({ code: "UNGROUNDED_OUTPUT", severity: "high", message: `AI review: the output claims things the tools never returned. ${verdict.reason}` });
    if (extra.length === 0) extra.push({ code: "AI_REVIEW_PASSED", severity: "low", message: `AI review: ${verdict.reason}` });
    const all = [...issues, ...extra];
    const scored = all.filter((i) => i.code !== "AI_REVIEW_PASSED");
    run("UPDATE agent_runs SET issues_json = ?, score = ? WHERE id = ?", JSON.stringify(all), agentScore(scored), id);
    await alertOnIssues(projectId, agent, runId, extra.filter((i) => i.code !== "AI_REVIEW_PASSED"));
  } catch (err) {
    const message = err instanceof JudgeError ? err.message : "AI review failed";
    const all = [...issues, { code: "AI_REVIEW_SKIPPED", severity: "low" as const, message }];
    run("UPDATE agent_runs SET issues_json = ? WHERE id = ?", JSON.stringify(all), id);
  }
}
