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

const { callCost, costSummary, customerCosts, recordAiUsage, userMonthCost } = await import("@/lib/aicost");
const { createAudit, executeAudit } = await import("@/lib/audit/run");
const { get, run } = await import("@/lib/db");
const { freshDb } = await import("./helpers");

let projectId: number;
let userId: number;
beforeEach(() => {
  ({ projectId, userId } = freshDb());
  parse.mockReset();
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_PAID_TIER;
});

describe("AI cost math", () => {
  it("prices Anthropic calls including cache reads and writes", () => {
    // 1,000 input × $4 + 6,000 cache reads × $0.20 + 2,000 cache writes × $5 + 500 output × $20 (per million)
    expect(callCost("anthropic", "claude-opus-5-5", { input: 1000, output: 500, cacheRead: 6000, cacheWrite: 2000 })).toBeCloseTo(0.0252, 6);
    expect(callCost("anthropic", "claude-sonnet-5-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(2);
    expect(callCost("anthropic", "claude-opus-5", { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(25);
    expect(callCost("anthropic", "some-future-model", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull();
    expect(callCost("gemini", "gemini-2.5-flash", { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 })).toBe(0);
    process.env.GEMINI_PAID_TIER = "1";
    expect(callCost("gemini", "gemini-2.5-flash", { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});

describe("recording and reports", () => {
  it("records every Claude audit call with its cost, linked to the customer", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    parse.mockResolvedValue({
      model: "claude-opus-5-5", stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 },
      parsed_output: { grades: [{ turn_index: 1, verdict: "correct", severity: "none", reason: "ok", source_doc: null, confidence: 0.9 }] },
    });
    const { id } = createAudit(projectId, "Cost test");
    await executeAudit(id, projectId, [
      { id: "a", turns: [{ role: "user", content: "Hi?" }, { role: "assistant", content: "Hello!" }] },
      { id: "b", turns: [{ role: "user", content: "Hours?" }, { role: "assistant", content: "9 to 5." }] },
    ]);
    expect(get<{ status: string }>("SELECT status FROM audits WHERE id = ?", id)?.status).toBe("done");
    const rows = get<{ n: number; cost: number; user: number; kind: string }>("SELECT COUNT(*) AS n, SUM(cost_usd) AS cost, MAX(user_id) AS user, MAX(kind) AS kind FROM ai_usage");
    expect(rows).toMatchObject({ n: 2, user: userId, kind: "audit" });
    expect(rows!.cost).toBeCloseTo(2 * 0.0152, 6);
    expect(userMonthCost(userId).calls).toBe(2);
    const s = costSummary();
    expect(s.byKind.audit.calls).toBe(2);
    expect(s.perConversation).toBeCloseTo(0.0152, 6);
    expect(s.byModel[0].model).toBe("claude-opus-5-5");
  });

  it("flags customers whose AI cost is high compared with what they pay", () => {
    const u = { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }; // $20 on Opus 5.5
    run("UPDATE users SET plan = 'starter', plan_status = 'active' WHERE id = ?", userId);
    recordAiUsage({ projectId, kind: "live" }, "anthropic", "claude-opus-5-5", u);
    recordAiUsage({ projectId, kind: "live" }, "anthropic", "claude-opus-5-5", u); // $40 vs $29
    const [c] = customerCosts();
    expect(c).toMatchObject({ userId, revenue: 29, calls: 2, flag: "loss" });
    expect(c.cost).toBeCloseTo(40, 6);

    run("UPDATE users SET plan = 'growth', plan_status = 'active' WHERE id = ?", userId); // $40 vs $79 → 51%
    expect(customerCosts()[0].flag).toBe("watch");
    run("UPDATE users SET plan = 'growth', plan_status = 'comped' WHERE id = ?", userId); // founding: pays $0
    expect(customerCosts()[0]).toMatchObject({ revenue: 0, share: null, flag: "watch" });
  });

  it("separates months and never fails grading when recording goes wrong", () => {
    recordAiUsage({ projectId, kind: "audit" }, "anthropic", "claude-opus-5-5", { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 });
    run("UPDATE ai_usage SET created_at = '2020-01-15 10:00:00'");
    expect(costSummary().calls).toBe(0);
    expect(costSummary("2020-01-01", "2020-02-01").calls).toBe(1);
    expect(() => recordAiUsage({ projectId: -1, kind: "audit" }, "anthropic", "x", { input: Number.NaN, output: 0, cacheRead: 0, cacheWrite: 0 })).not.toThrow();
  });
});
