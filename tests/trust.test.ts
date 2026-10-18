import { beforeEach, describe, expect, it } from "vitest";
import { POST as checkPost } from "@/app/api/v1/check/route";
import { run } from "@/lib/db";
import { autonomyFor, decisionFor, trustReport, wilsonLower } from "@/lib/trust";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => ({ projectId } = freshDb()));

/** Adds `n` checked answers in a topic, `bad` of them made up (high severity when `serious`). */
function answers(topic: string, n: number, bad = 0, serious = false) {
  const audit = run("INSERT INTO audits (project_id, name, mode, status, judge) VALUES (?, 'Live', 'live', 'live', 'heuristic')", projectId).lastInsertRowid;
  for (let i = 0; i < n; i++) {
    const wrong = i < bad;
    run(
      `INSERT INTO audit_items (audit_id, conversation_id, turn_index, question, answer, verdict, severity, reason, confidence, features_json, topic, created_at)
       VALUES (?, ?, 0, 'q', 'a', ?, ?, 'r', 0.9, '{}', ?, datetime('now'))`,
      audit, `${topic}-${i}`, wrong ? "hallucination" : "correct", wrong ? (serious ? "high" : "medium") : "none", topic,
    );
  }
}

describe("trust maths", () => {
  it("needs volume before it vouches for accuracy", () => {
    expect(wilsonLower(19, 20)).toBeLessThan(0.8);
    expect(wilsonLower(990, 1000)).toBeGreaterThan(0.98);
    expect(autonomyFor(10, 10, 0).autonomy).toBe("not_enough_data");
    expect(autonomyFor(19, 20, 0).autonomy).toBe("human_review");
    expect(autonomyFor(199, 200, 0).autonomy).toBe("autopilot");
    expect(autonomyFor(185, 200, 0).autonomy).toBe("spot_check");
    expect(autonomyFor(199, 200, 1).autonomy).toBe("spot_check"); // 99%+ but one serious mistake: no autopilot
    expect(autonomyFor(170, 200, 2).autonomy).toBe("human_review");
  });

  it("decides allow, review or block", () => {
    expect(decisionFor("correct", "none")).toBe("allow");
    expect(decisionFor("correct", "none", "human_review")).toBe("review");
    expect(decisionFor("unsupported", "medium")).toBe("review");
    expect(decisionFor("hallucination", "high")).toBe("block");
    expect(decisionFor("off_policy", "medium")).toBe("block");
    expect(decisionFor("hallucination", "low")).toBe("review");
    expect(decisionFor("should_escalate", "high")).toBe("block");
  });
});

describe("trust report", () => {
  it("rates each area and counts human agreement", () => {
    answers("Shipping", 300);
    answers("Refunds", 60, 9, true);
    answers("Warranty", 5);
    run("UPDATE audit_items SET feedback = 'agree' WHERE id <= 18");
    run("UPDATE audit_items SET feedback = 'disagree', corrected_verdict = 'correct' WHERE id IN (301, 302)");
    const t = trustReport(projectId);
    const by = Object.fromEntries(t.areas.map((a) => [a.area, a]));
    expect(by.Shipping.autonomy).toBe("autopilot");
    expect(by.Refunds.autonomy).toBe("human_review");
    expect(by.Refunds.serious).toBe(7); // two of the nine were corrected to "correct" by a human
    expect(by.Warranty.autonomy).toBe("not_enough_data");
    expect(t.areas[0].area).toBe("Refunds"); // most urgent first
    expect(t.humanCheck).toEqual({ reviewed: 20, agreed: 18, agreement: 90 });
    expect(t.autopilotShare).toBe(83);
    expect(t.score).toBeGreaterThan(90);
  });
});

describe("POST /api/v1/check", () => {
  const req = (body: unknown) => new Request("http://x/api/v1/check", { method: "POST", headers: { authorization: "Bearer ap_live_test" }, body: JSON.stringify(body) });
  beforeEach(() => {
    run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 'Shipping', 'Express shipping costs 15 dollars and takes 2 business days.')", projectId);
  });

  it("allows a supported answer and returns the decision with the reason", async () => {
    const res = await checkPost(req({ question: "How much is express shipping?", answer: "Express shipping costs 15 dollars." }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ decision: "allow", verdict: "correct" });
    expect(body.advice).toBe("Safe to send.");
  });

  it("does not let an unsupported answer through", async () => {
    const body = await (await checkPost(req({ question: "Do you ship to Mars?", answer: "Yes, we ship to Mars for free with a lifetime warranty." }))).json();
    expect(["review", "block"]).toContain(body.decision);
  });

  it("checks the same reply every time, and validates input", async () => {
    const b = { question: "How much is express shipping?", answer: "Express shipping costs 15 dollars.", conversation_id: "same" };
    expect((await (await checkPost(req(b))).json()).decision).toBe("allow");
    expect((await (await checkPost(req(b))).json()).decision).toBe("allow");
    expect((await checkPost(req({ question: "hi" }))).status).toBe(400);
  });
});
