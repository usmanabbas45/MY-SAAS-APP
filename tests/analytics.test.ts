import { beforeEach, describe, expect, it } from "vitest";
import { POST as feedbackPost } from "@/app/api/v1/feedback/route";
import { chatAnalytics } from "@/lib/analytics-chat";
import { all, run } from "@/lib/db";
import { createDemoProject } from "@/lib/demo";
import { feedbackValue } from "@/lib/feedback";
import { ruleTopic, topicFor } from "@/lib/topics";
import { freshDb } from "./helpers";

let projectId: number, userId: number, audit: number;
const now = new Date("2026-10-04T12:00:00Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString().replace("T", " ").slice(0, 19);
function reply(conv: string, q: string, verdict: string, daysAgo: number, extra: { flags?: string; latency?: number; doc?: string; topic?: string } = {}) {
  run(`INSERT INTO audit_items (audit_id, conversation_id, turn_index, question, answer, verdict, severity, reason, source_doc, confidence, features_json, created_at, conv_flags, latency_ms, topic)
       VALUES (?, ?, 1, ?, 'a', ?, ?, 'why', ?, 0.9, '[]', ?, ?, ?, ?)`,
    audit, conv, q, verdict, verdict === "correct" ? "none" : "high", extra.doc ?? null, at(daysAgo), extra.flags ?? null, extra.latency ?? null, extra.topic ?? null);
}
beforeEach(() => {
  ({ projectId, userId } = freshDb());
  audit = run("INSERT INTO audits (project_id, name, mode, status) VALUES (?, 'live', 'ai', 'live')", projectId).lastInsertRowid;
});

describe("topics", () => {
  it("prefers the AI topic, then the help article, then keyword rules", () => {
    expect(topicFor("where is my parcel", null, "delivery tracking")).toBe("Delivery tracking");
    expect(topicFor("where is my parcel", "Shipping & delivery")).toBe("Shipping & delivery");
    expect(topicFor("can I get a refund?", null)).toBe("Returns & refunds");
    expect(topicFor("I want to talk to a real person", null)).toBe("Talk to a human");
    expect(topicFor("hello!", null)).toBe("Greetings & small talk");
    expect(ruleTopic("what is the meaning of life")).toBeNull();
    expect(topicFor("what is the meaning of life", null)).toBe("Other");
  });
});

describe("customer feedback", () => {
  it("turns thumbs and stars into 0..1", () => {
    expect([feedbackValue("up"), feedbackValue("down"), feedbackValue(true), feedbackValue(5), feedbackValue(1), feedbackValue(3), feedbackValue(0.8)]).toEqual([1, 0, 1, 1, 0, 0.5, 0.8]);
  });
  it("accepts ratings through the API with the project key", async () => {
    const req = (body: unknown, key = "ap_live_test") => new Request("http://x/api/v1/feedback", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    expect((await feedbackPost(req({ conversation_id: "c1", rating: "down", comment: "wrong price" }))).status).toBe(201);
    expect((await feedbackPost(req({ conversation_id: "c1", rating: "meh" }))).status).toBe(400);
    expect((await feedbackPost(req({ conversation_id: "c1", rating: "up" }, "nope"))).status).toBe(401);
    expect(all("SELECT conversation_id, value, comment FROM chat_feedback")).toEqual([{ conversation_id: "c1", value: 0, comment: "wrong price" }]);
  });
});

describe("chatbot analytics", () => {
  it("computes volume, accuracy, resolution, escalation, satisfaction, latency, topics and doc gaps", () => {
    reply("c1", "how much is delivery?", "correct", 1, { latency: 1000, doc: "Delivery" });
    reply("c1", "and to Ireland?", "unsupported", 1, { latency: 3000 }); // not in docs
    reply("c2", "refund please", "correct", 2, { latency: 2000 });
    reply("c3", "I want a human NOW", "should_escalate", 2, { latency: 500 });
    reply("c4", "refund please", "correct", 3, { flags: "re_ask" });
    reply("old", "hi", "correct", 40); // outside 30 days
    run("INSERT INTO chat_feedback (project_id, conversation_id, value, created_at) VALUES (?, 'c2', 1, ?), (?, 'c3', 0, ?)", projectId, at(2), projectId, at(2));

    const a = chatAnalytics(projectId, 30, now);
    expect(a.kpis).toMatchObject({ conversations: 4, replies: 5, repliesPerConversation: 1.3, accuracy: 60, resolution: 25, escalation: 25, satisfaction: 50, ratings: 2, latencyAvg: 1625, latencyP95: 3000 });
    expect(a.previous.replies).toBe(1);
    expect(a.daily).toHaveLength(30);
    expect(a.daily.at(-2)).toMatchObject({ conversations: 1, replies: 2, accuracy: 50 });
    const topics = Object.fromEntries(a.topics.map((t) => [t.topic, t]));
    expect(topics["Returns & refunds"]).toMatchObject({ replies: 2, accuracy: 100, satisfaction: 100, ratings: 1 });
    expect(topics["Talk to a human"]).toMatchObject({ replies: 1, accuracy: 0, satisfaction: 0 });
    expect(a.gaps).toEqual([{ question: "and to Ireland?", topic: "Other", count: 1, reason: "why" }]);
  });

  it("the demo project has a full analytics page", async () => {
    const id = await createDemoProject(userId);
    const a = chatAnalytics(id, 30);
    expect(a.kpis.conversations).toBeGreaterThan(80);
    expect(a.kpis.ratings).toBeGreaterThan(20);
    expect(a.topics.length).toBeGreaterThanOrEqual(5);
    expect(a.daily.filter((d) => d.replies).length).toBeGreaterThanOrEqual(14);
  });
});
