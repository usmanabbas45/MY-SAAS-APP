import { beforeEach, describe, expect, it } from "vitest";
import { agentScore, AgentRunSchema, checkAgentRun } from "@/lib/agents/checks";
import { ingestAgentRun } from "@/lib/agents/ingest";
import { all } from "@/lib/db";
import { freshDb } from "./helpers";

const limits = { costBudgetUsd: 1, maxSteps: 25, maxMs: 120000 };
const codes = (body: unknown) => checkAgentRun(AgentRunSchema.parse(body), limits).map((i) => i.code);

describe("agent checks", () => {
  it("passes a clean run", () => {
    const issues = checkAgentRun(AgentRunSchema.parse({
      run_id: "1", agent_name: "a", final_output: "done",
      steps: [{ type: "tool", name: "search", input: { q: "x" }, output: "ok", cost_usd: 0.01, duration_ms: 500 }],
    }), limits);
    expect(issues).toEqual([]);
    expect(agentScore(issues)).toBe(100);
  });

  it("detects loops, tool errors, empty output and budget overruns", () => {
    const step = { type: "tool", name: "search", input: { q: "same" }, cost_usd: 1.5 };
    const c = codes({
      run_id: "2", agent_name: "a", final_output: "",
      steps: [step, step, { ...step, error: "timeout" }],
    });
    expect(c).toEqual(expect.arrayContaining(["LOOP_DETECTED", "TOOL_ERRORS", "EMPTY_OUTPUT", "OVER_BUDGET", "ENDED_ON_ERROR"]));
  });

  it("flags failed runs and too many steps", () => {
    const steps = Array.from({ length: 30 }, (_, i) => ({ type: "llm", name: `s${i}` }));
    expect(codes({ run_id: "3", agent_name: "a", status: "error", steps })).toEqual(expect.arrayContaining(["RUN_FAILED", "TOO_MANY_STEPS"]));
  });
});

describe("agent ingestion", () => {
  let projectId: number;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    ({ projectId } = freshDb());
  });

  it("stores runs, rejects duplicates and invalid payloads, and opens incidents", async () => {
    const body = { run_id: "r1", agent_name: "Researcher", status: "error", steps: [] };
    const first = await ingestAgentRun(projectId, body);
    expect(first.ok).toBe(true);
    const dup = await ingestAgentRun(projectId, body);
    expect(dup).toMatchObject({ ok: false, status: 409 });
    const bad = await ingestAgentRun(projectId, { agent_name: "x" });
    expect(bad).toMatchObject({ ok: false, status: 400 });
    expect(all("SELECT * FROM incidents WHERE project_id = ?", projectId)).toHaveLength(1);
  });
});
