import { beforeEach, describe, expect, it } from "vitest";
import { ingestAgentRun } from "@/lib/agents/ingest";
import { createAudit, NOT_STORED, storeGradedItem } from "@/lib/audit/run";
import { all, get, run } from "@/lib/db";
import { buildKbIndex } from "@/lib/judge/features";
import { aiForProject } from "@/lib/judge/llm";
import { customMatcher, redactPII } from "@/lib/pii";
import { purgeExpired } from "@/lib/retention";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  ({ projectId } = freshDb());
});

describe("stronger masking", () => {
  it("masks UK postcodes, number plates and self-introduced names", () => {
    expect(redactPII("I'm at AL2 3TZ, reg AB12 CDE, my name is Anna Smith")).toBe("I'm at [postcode], reg [reg], my name is [name]");
    expect(redactPII("postcode sw1a 1aa and plate ab12cde")).toBe("postcode [postcode] and plate [reg]");
    expect(redactPII("Name: John")).toBe("Name: [name]");
  });

  it("keeps ordinary text, prices and headings", () => {
    const text = "Express shipping is £15 and takes 2 days. See our Q3 FAQ and the Top 10 tips. Windscreens are not covered.";
    expect(redactPII(text)).toBe(text);
  });

  it("masks custom words literally, case-insensitively and without regex injection", () => {
    const m = customMatcher("Anna Smith\nAB Dealers\n(.*)\nx");
    expect(redactPII("Hi, AB DEALERS here for anna smith (.*) text", m)).toBe("Hi, [masked] here for [masked] [masked] text");
    expect(redactPII("Annabel", customMatcher("Anna"))).toBe("Annabel");
    expect(customMatcher("  \n ")).toBeNull();
  });
});

describe("privacy controls", () => {
  const exchange = { conversationId: "c1", turnIndex: 1, question: "Is my windscreen covered? I'm furious", answer: "Yes, fully covered", history: [] };
  const grade = { verdict: "hallucination" as const, severity: "high" as const, reason: "Docs say windscreens are excluded", sourceDoc: null, confidence: 0.9 };

  it("results-only mode keeps the verdict but not the conversation text", () => {
    run("UPDATE projects SET store_text = 0 WHERE id = ?", projectId);
    const { id } = createAudit(projectId, "a");
    storeGradedItem(id, exchange as never, grade as never, buildKbIndex([]), null, []);
    const row = get<{ question: string; answer: string; verdict: string; frustrated: number }>("SELECT question, answer, verdict, frustrated FROM audit_items");
    expect(row).toMatchObject({ question: NOT_STORED, answer: NOT_STORED, verdict: "hallucination", frustrated: 1 });
  });

  it("masks and strips agent runs", async () => {
    run("UPDATE projects SET store_text = 0 WHERE id = ?", projectId);
    const r = await ingestAgentRun(projectId, {
      run_id: "r1", agent_name: "Claims bot", goal: "Book AB12 CDE in", status: "success", final_output: "Booked for my name is Tom Jones",
      steps: [{ type: "tool", name: "crm", input: { reg: "AB12 CDE" }, output: "ok", duration_ms: 10 }],
    });
    expect(r.ok).toBe(true);
    const row = get<{ goal: string; final_output: string; steps_json: string }>("SELECT goal, final_output, steps_json FROM agent_runs");
    expect(row!.goal + row!.final_output).toBe("");
    const steps = JSON.parse(row!.steps_json);
    expect(steps[0]).toMatchObject({ type: "tool", name: "crm", duration_ms: 10 });
    expect(steps[0]).not.toHaveProperty("input");
    expect(steps[0]).not.toHaveProperty("output");
  });

  it("masks agent run text when stored", async () => {
    await ingestAgentRun(projectId, { run_id: "r2", agent_name: "Bot", goal: "Call +44 20 7946 0958", status: "success", final_output: "Done for AL2 3TZ", steps: [] });
    expect(get("SELECT goal, final_output FROM agent_runs")).toEqual({ goal: "Call [phone]", final_output: "Done for [postcode]" });
  });

  it("switching AI off keeps data inside ProofMyAI", () => {
    process.env.GEMINI_API_KEY = "x";
    expect(aiForProject(projectId)).toBe(true);
    run("UPDATE projects SET use_ai = 0 WHERE id = ?", projectId);
    expect(aiForProject(projectId)).toBe(false);
    expect(createAudit(projectId, "a").mode).toBe("basic");
  });

  it("deletes data older than the retention period only", () => {
    run("UPDATE projects SET retention_days = 7 WHERE id = ?", projectId);
    const old = run("INSERT INTO audits (project_id, name, mode, status, created_at) VALUES (?, 'old', 'basic', 'done', datetime('now', '-10 days'))", projectId).lastInsertRowid;
    const recent = run("INSERT INTO audits (project_id, name, mode, status) VALUES (?, 'new', 'basic', 'done')", projectId).lastInsertRowid;
    const item = (audit: number, age: string) => run(
      `INSERT INTO audit_items (audit_id, conversation_id, turn_index, question, answer, verdict, severity, reason, confidence, features_json, created_at)
       VALUES (?, 'c', 1, 'q', 'a', 'correct', 'none', 'r', 1, '{}', datetime('now', ?))`, audit, age);
    item(old, "-10 days");
    item(recent, "-1 days");
    run("INSERT INTO agent_runs (project_id, external_id, agent_name, goal, status, final_output, steps_json, total_cost_usd, total_ms, issues_json, score, created_at) VALUES (?, 'x', 'a', '', 'success', '', '[]', 0, 0, '[]', 100, datetime('now', '-8 days'))", projectId);
    const r = purgeExpired();
    expect(r).toMatchObject({ projects: 1, items: 1, agentRuns: 1 });
    expect(all("SELECT name FROM audits")).toEqual([{ name: "new" }]);
    run("UPDATE projects SET retention_days = 0");
    expect(purgeExpired().projects).toBe(0);
  });
});
