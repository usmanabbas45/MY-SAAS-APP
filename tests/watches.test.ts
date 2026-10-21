import { beforeEach, describe, expect, it } from "vitest";
import { all, run } from "@/lib/db";
import { addWatch, backtest, evaluateWatches, validateSpec, type WatchModule } from "@/lib/watches";
import { parseWatchPrompt, translateWatch } from "@/lib/watchparse";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => ({ projectId } = freshDb()));

const parse = (m: WatchModule, p: string) => parseWatchPrompt(m, p);

describe("plain-English prompts become rules", () => {
  it("workflows: counts per day, silence, empty output and failures", () => {
    expect(parse("workflows", "Alert me if the Order sync workflow runs fewer than 10 times a day")).toMatchObject({
      kind: "below", threshold: 10, window_minutes: 1440, filters: [{ field: "workflow_name", op: "contains", value: "Order sync" }],
    });
    expect(parse("workflows", "Notify me if Lead import hasn't run for 2 hours")).toMatchObject({ kind: "below", threshold: 1, window_minutes: 120 });
    expect(parse("workflows", "Tell me when any workflow returns 0 items")).toMatchObject({ kind: "each", filters: [{ field: "output_items", op: "eq", value: 0 }] });
    expect(parse("workflows", "Alert me if more than 3 workflows fail in an hour")).toMatchObject({ kind: "above", threshold: 3, window_minutes: 60, filters: [{ field: "status", value: "error" }] });
  });

  it("agents: money, steps and failures", () => {
    expect(parse("agents", "Alert me if any agent run costs more than $1")).toMatchObject({ kind: "each", filters: [{ field: "cost_usd", op: "gt", value: 1 }] });
    expect(parse("agents", "Notify me if an agent takes more than 20 steps")).toMatchObject({ filters: [{ field: "steps", op: "gt", value: 20 }] });
    expect(parse("agents", "Tell me when the Refund agent fails twice in an hour")).toMatchObject({
      kind: "above", threshold: 1, window_minutes: 60,
      filters: expect.arrayContaining([{ field: "status", op: "eq", value: "error" }, { field: "agent_name", op: "contains", value: "Refund" }]),
    });
  });

  it("chatbot, approvals, CRM and uptime", () => {
    expect(parse("chatbot", "Alert me when the bot gives more than 3 made-up answers in an hour")).toMatchObject({ kind: "above", threshold: 3, filters: [{ field: "verdict", value: "hallucination" }] });
    expect(parse("chatbot", "Tell me whenever an answer mentions a refund")).toMatchObject({ kind: "each", filters: [{ field: "answer", op: "contains", value: "refund" }] });
    expect(parse("chatbot", "Notify me if a reply takes longer than 10 seconds")).toMatchObject({ filters: [{ field: "response_ms", op: "gt", value: 10000 }] });
    expect(parse("approvals", "Alert me for any refund over 200")).toMatchObject({ kind: "each", filters: expect.arrayContaining([{ field: "amount", op: "gt", value: 200 }, { field: "action", op: "contains", value: "refund" }]) });
    expect(parse("crm", "Alert me if fewer than 5 new leads arrive in a day")).toMatchObject({ kind: "below", threshold: 5, window_minutes: 1440 });
    expect(parse("crm", "Tell me when a new lead has no email")).toMatchObject({ filters: [{ field: "has_email", value: 0 }] });
    expect(parse("uptime", "Alert me if the website takes longer than 3 seconds to answer")).toMatchObject({ filters: [{ field: "response_ms", op: "gt", value: 3000 }] });
  });

  it("refuses prompts it can't understand instead of guessing, and explains with an example", async () => {
    expect(parse("workflows", "keep an eye on things please")).toBeNull();
    const r = await translateWatch(projectId, "workflows", "keep an eye on things please");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/Try something like/);
  });

  it("only allows the module's own fields (no SQL from prompts)", () => {
    expect(validateSpec("agents", { kind: "each", filters: [{ field: "password_hash", op: "eq", value: "x" }], severity: "high", summary: "" }).ok).toBe(false);
    expect(validateSpec("agents", { kind: "each", filters: [{ field: "agent_name", op: "gt", value: 3 }], severity: "high", summary: "" }).ok).toBe(false);
    expect(validateSpec("agents", { kind: "above", filters: [], severity: "high", summary: "" }).ok).toBe(false);
  });

  it("describes the rule in plain English from the rule itself", () => {
    expect(parse("workflows", "Alert me if the Order sync workflow runs fewer than 10 times a day")?.summary)
      .toBe("Alert if there are fewer than 10 n8n, Make and webhook workflow runs where workflow name contains “Order sync” in a day (high priority).");
  });
});

describe("watches fire and resolve", () => {
  const wf = (name: string, status: string, items: number, at: Date) =>
    run("INSERT INTO workflow_runs (project_id, platform, workflow_id, workflow_name, execution_id, status, started_at, output_items) VALUES (?, 'n8n', ?, ?, ?, ?, ?, ?)",
      projectId, name, name, `${name}-${at.getTime()}-${Math.random()}`, status, at.toISOString(), items);
  const incidents = () => all<{ title: string; detail: string; resolved: number }>("SELECT title, detail, resolved FROM incidents WHERE project_id = ? AND code = 'WATCH_TRIGGERED'", projectId);

  it("an 'each' watch alerts once on new matches, with examples, and doesn't repeat while open", async () => {
    const t0 = new Date("2026-10-21T10:00:00Z");
    const spec = parse("workflows", "Tell me when any workflow returns 0 items")!;
    addWatch(projectId, "workflows", "Tell me when any workflow returns 0 items", spec, t0);
    wf("Order sync", "success", 0, new Date(t0.getTime() + 60000));
    wf("Order sync", "success", 12, new Date(t0.getTime() + 120000));
    expect(await evaluateWatches(projectId, new Date(t0.getTime() + 300000), { force: true })).toBe(1);
    expect(incidents()[0].title).toBe("Your watch: Tell me when any workflow returns 0 items");
    expect(incidents()[0].detail).toContain("1 new match");
    expect(incidents()[0].detail).toContain("“Order sync” success, 0 items out");
    wf("Order sync", "success", 0, new Date(t0.getTime() + 400000));
    expect(await evaluateWatches(projectId, new Date(t0.getTime() + 500000), { force: true })).toBe(0); // grouped while open
    expect(incidents()).toHaveLength(1);
  });

  it("a 'fewer than' watch waits a full window, then fires, then resolves when volume returns", async () => {
    const t0 = new Date("2026-10-21T00:00:00Z");
    const prompt = "Alert me if the Order sync workflow runs fewer than 3 times in 1 hours";
    const spec = parse("workflows", prompt)!;
    addWatch(projectId, "workflows", prompt, spec, t0);
    expect(await evaluateWatches(projectId, new Date(t0.getTime() + 30 * 60000), { force: true })).toBe(0); // too early to judge
    wf("Order sync", "success", 5, new Date(t0.getTime() + 70 * 60000));
    expect(await evaluateWatches(projectId, new Date(t0.getTime() + 80 * 60000), { force: true })).toBe(1);
    expect(incidents()[0].detail).toContain("1 in the last hour");
    for (let i = 0; i < 3; i++) wf("Order sync", "success", 5, new Date(t0.getTime() + (85 + i) * 60000));
    await evaluateWatches(projectId, new Date(t0.getTime() + 90 * 60000), { force: true });
    expect(incidents()[0].resolved).toBe(1);
  });

  it("backtests a new watch over the last 7 days", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    for (let d = 1; d <= 3; d++) wf("Lead import", "error", 0, new Date(now.getTime() - d * 86400000));
    expect(backtest(projectId, "workflows", parse("workflows", "Alert me when Lead import fails")!, now)).toBe(3);
  });

  it("checks agent costs from the real table", async () => {
    const t0 = new Date("2026-10-21T10:00:00Z");
    addWatch(projectId, "agents", "cost", parse("agents", "Alert me if any agent run costs more than $1")!, t0);
    run("INSERT INTO agent_runs (project_id, external_id, agent_name, goal, status, final_output, steps_json, total_cost_usd, total_ms, issues_json, score, created_at) VALUES (?, 'r1', 'Researcher', '', 'success', 'ok', '[1,2,3]', 2.5, 100, '[]', 90, '2026-10-21 10:05:00')", projectId);
    expect(await evaluateWatches(projectId, new Date("2026-10-21T10:10:00Z"), { force: true })).toBe(1);
    expect(incidents()[0].detail).toContain("Agent “Researcher”, success, $2.5000, 3 steps");
  });
});
