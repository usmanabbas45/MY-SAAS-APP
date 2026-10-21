import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    beta = { messages: { parse } };
  }
  return { default: Anthropic };
});

const { llmGradeConversation } = await import("@/lib/judge/llm");
const { applyRules, aiChecks, projectRules } = await import("@/lib/rules");
const { run } = await import("@/lib/db");
const { freshDb } = await import("./helpers");

let projectId: number;
const docs = [{ title: "Pricing", content: "Plans start at $29 a month. Every plan has a 14-day free trial." }];
const ex = { conversationId: "c1", turnIndex: 1, question: "How much is it?", answer: "Plans start at $29 a month." };

beforeEach(() => {
  ({ projectId } = freshDb());
  parse.mockReset();
  process.env.ANTHROPIC_API_KEY = "test";
  parse.mockResolvedValue({
    model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
    parsed_output: { grades: [{ turn_index: 1, verdict: "off_policy", severity: "high", reason: "Broke your check: Pricing answers must mention the 14-day free trial", source_doc: "Pricing", confidence: 0.9, evidence: "Every plan has a 14-day free trial." }] },
  });
});
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });

describe("custom AI checks in plain English", () => {
  it("sends the project's checks to the AI judge and returns its verdict with verified evidence", async () => {
    run("INSERT INTO rules (project_id, kind, pattern) VALUES (?, 'ai_check', 'Pricing answers must mention the 14-day free trial')", projectId);
    const [g] = await llmGradeConversation([ex], docs, { projectId, kind: "live" });
    const sent = JSON.stringify(parse.mock.calls[0][0]);
    expect(sent).toContain("<business_checks>");
    expect(sent).toContain("1. Pricing answers must mention the 14-day free trial");
    expect(g).toMatchObject({ verdict: "off_policy", evidence: "Every plan has a 14-day free trial." });
  });

  it("sends no checks block when the project has none, and keyword rules ignore AI checks", async () => {
    await llmGradeConversation([ex], docs, { projectId, kind: "live" });
    expect(JSON.stringify(parse.mock.calls[0][0])).not.toContain("<business_checks>");
    run("INSERT INTO rules (project_id, kind, pattern) VALUES (?, 'ai_check', 'Never mention competitors')", projectId);
    expect(aiChecks(projectId)).toEqual(["Never mention competitors"]);
    const grade = { turnIndex: 1, verdict: "correct" as const, severity: "none" as const, reason: "ok", sourceDoc: null, confidence: 0.9 };
    expect(applyRules({ ...ex, answer: "Never mention competitors" }, grade, projectRules(projectId)).hit).toBeNull();
  });
});
