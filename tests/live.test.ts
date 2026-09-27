import { beforeEach, describe, expect, it } from "vitest";
import { gradeLiveChat, LiveChatSchema, liveAuditName, newExchanges } from "@/lib/audit/live";
import { fixList } from "@/lib/audit/run";
import { all, get, run } from "@/lib/db";
import { projectHealth } from "@/lib/health";
import { liveFeed, sourceStatuses, toMs } from "@/lib/live";
import { recordWorkflowRun } from "@/lib/workflows/monitor";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  ({ projectId } = freshDb());
  run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 'Shipping', 'Express shipping costs 15 dollars and takes 2 business days.')", projectId);
});

const send = async (body: unknown) => {
  const chat = LiveChatSchema.parse(body);
  return gradeLiveChat(projectId, newExchanges(projectId, chat));
};

describe("live chatbot tracking", () => {
  it("grades new replies instantly into today's live audit", async () => {
    const grades = await send({ conversation_id: "c1", question: "How much is express shipping?", answer: "Express shipping costs 15 dollars." });
    expect(grades).toHaveLength(1);
    expect(grades[0].verdict).toBe("correct");
    const audit = get<{ name: string; status: string; score: number }>("SELECT name, status, score FROM audits WHERE project_id = ?", projectId)!;
    expect(audit).toMatchObject({ name: liveAuditName(), status: "live", score: 100 });
  });

  it("only grades new replies when the full history is resent", async () => {
    const turns = [
      { role: "user", content: "Hi" }, { role: "assistant", content: "Hello! How can I help?" },
    ];
    expect(await send({ conversation_id: "c2", messages: turns })).toHaveLength(1);
    expect(await send({ conversation_id: "c2", messages: turns })).toHaveLength(0);
    const more = [...turns, { role: "customer", content: "Express price?" }, { role: "bot", content: "Express shipping costs 99 dollars." }];
    const g = await send({ conversation_id: "c2", messages: more });
    expect(g).toHaveLength(1);
    expect(g[0].verdict).toBe("hallucination");
  });

  it("numbers repeated single question/answer events for the same conversation", async () => {
    await send({ conversation_id: "c3", question: "Hi", answer: "Hello!" });
    await send({ conversation_id: "c3", question: "Shipping price?", answer: "Express shipping costs 15 dollars." });
    const turns = all<{ turn_index: number }>("SELECT turn_index FROM audit_items ORDER BY id").map((r) => r.turn_index);
    expect(new Set(turns).size).toBe(2);
  });

  it("raises one deduplicated incident for repeated high-risk answers and feeds the fix list", async () => {
    await send({ conversation_id: "a", question: "Express price?", answer: "It costs 99 dollars, arrives in 1 day." });
    await send({ conversation_id: "b", question: "Express price?", answer: "It costs 79 dollars, arrives in 1 day." });
    expect(all("SELECT id FROM incidents WHERE resolved = 0")).toHaveLength(1);
    const audit = get<{ id: number }>("SELECT id FROM audits WHERE status = 'live'")!;
    expect(fixList(audit.id)[0].count).toBe(2);
    expect(projectHealth(projectId).modules.chatbot.score).toBeLessThan(100);
  });

  it("validates payloads", () => {
    expect(LiveChatSchema.safeParse({ conversation_id: "x" }).success).toBe(false);
    expect(LiveChatSchema.safeParse({ conversation_id: "x", question: "q", answer: "  " }).success).toBe(false);
    expect(() => newExchanges(projectId, LiveChatSchema.parse({ conversation_id: "x", messages: [{ role: "robot", content: "hi" }] }))).toThrow(/unknown role/);
  });
});

describe("live feed and status", () => {
  it("merges chatbot, agent and workflow events newest first with states", async () => {
    await send({ conversation_id: "a", question: "Express price?", answer: "It costs 99 dollars, arrives in 1 day." });
    await recordWorkflowRun(projectId, { platform: "n8n", workflow_id: "w", workflow_name: "Orders", execution_id: "1", status: "error", error_message: "boom" });
    run(`INSERT INTO agent_runs (project_id, external_id, agent_name, goal, status, final_output, steps_json, total_cost_usd, total_ms, issues_json, score)
         VALUES (?, 'r1', 'Researcher', '', 'success', 'ok', '[]', 0.01, 100, '[]', 100)`, projectId);
    const feed = liveFeed(projectId);
    expect(feed.map((e) => e.source).sort()).toEqual(["agents", "chatbot", "workflows"]);
    expect(feed.find((e) => e.source === "agents")?.ok).toBe(true);
    expect(feed.find((e) => e.source === "workflows")?.ok).toBe(false);
    const status = Object.fromEntries(sourceStatuses(projectId).map((s) => [s.source, s.state]));
    expect(status).toEqual({ chatbot: "problem", agents: "ok", workflows: "problem" });
  });

  it("reports idle sources and parses both timestamp formats", () => {
    expect(sourceStatuses(projectId).every((s) => s.state === "idle")).toBe(true);
    expect(toMs("2026-09-27 10:00:00")).toBe(Date.parse("2026-09-27T10:00:00Z"));
    expect(toMs("2026-09-27T10:00:00.000Z")).toBe(Date.parse("2026-09-27T10:00:00Z"));
    expect(toMs(null)).toBe(0);
  });
});
