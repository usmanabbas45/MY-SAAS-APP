import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("@/lib/security", async (orig) => ({
  ...(await orig<typeof import("@/lib/security")>()),
  assertPublicUrl: vi.fn(async (u: string) => new URL(u)),
  // A bot that answers correctly on production and wrongly on the preview deployment.
  safeFetch: vi.fn(async (url: string) => {
    calls.push(url);
    const reply = url.includes("preview") ? "Shipping is free for everyone, always." : "Express shipping costs 15 dollars.";
    return new Response(JSON.stringify({ reply }), { status: 200 });
  }),
}));

import { POST } from "@/app/api/v1/test-runs/route";
import { all, get, run } from "@/lib/db";
import { freshDb } from "./helpers";

let projectId: number;
const req = (body: unknown) => new Request("http://x/api/v1/test-runs", { method: "POST", headers: { authorization: "Bearer ap_live_test" }, body: JSON.stringify(body) });

beforeEach(() => {
  ({ projectId } = freshDb());
  calls.length = 0;
});

describe("POST /api/v1/test-runs (CI regression tests)", () => {
  it("asks for a bot when none is set up", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Chatbot tests/);
  });

  describe("with a saved bot and test questions", () => {
    beforeEach(() => {
      run("INSERT INTO bot_targets (project_id, name, url, body_template, response_path) VALUES (?, 'Support bot', 'https://bot.example/chat', '{\"message\": \"{{question}}\"}', 'reply')", projectId);
      run("INSERT INTO test_cases (project_id, question, expected, must_not) VALUES (?, 'How much is express shipping?', 'Express shipping costs 15 dollars', 'free for everyone')", projectId);
    });

    it("passes against the live bot and doesn't count as the nightly run", async () => {
      const body = await (await POST(req({}))).json();
      expect(body).toMatchObject({ ok: true, passed: 1, failed: 0, total: 1, bot: "Support bot", failures: [] });
      expect(calls).toEqual(["https://bot.example/chat"]);
      expect(get<{ last_run_at: string | null }>("SELECT last_run_at FROM bot_targets")?.last_run_at).toBeNull();
    });

    it("fails a preview deployment that breaks an answer, without raising a live incident", async () => {
      const body = await (await POST(req({ bot: "support bot", url: "https://preview-42.bot.example/chat" }))).json();
      expect(body.ok).toBe(false);
      expect(body.failed).toBe(1);
      expect(body.failures[0].reason).toMatch(/forbidden/);
      expect(calls).toEqual(["https://preview-42.bot.example/chat"]);
      expect(all("SELECT id FROM incidents WHERE project_id = ?", projectId)).toHaveLength(0);
    });

    it("accepts a lower pass rate and validates input", async () => {
      run("INSERT INTO test_cases (project_id, question, expected, must_not) VALUES (?, 'Is shipping free?', 'Standard shipping is free', '')", projectId);
      const body = await (await POST(req({ min_pass_rate: 0.5 }))).json();
      expect(body).toMatchObject({ ok: true, passed: 1, failed: 1, pass_rate: 0.5 });
      expect((await POST(req({ min_pass_rate: 2 }))).status).toBe(400);
      expect((await POST(req({ bot: "Unknown" }))).status).toBe(400);
    });
  });
});
