import { describe, expect, it } from "vitest";
import { buildKbIndex, featureVector, FEATURE_NAMES, signalsFor } from "@/lib/judge/features";
import { heuristicGrade } from "@/lib/judge/heuristic";
import { exchangesOf, type Exchange } from "@/lib/judge/types";
import { priorRisk } from "@/lib/ml/risk";

const kb = buildKbIndex([
  { title: "Refund policy", content: "Customers can request a refund within 30 days of purchase. Refunds are processed in 5 business days." },
  { title: "Shipping", content: "Standard shipping takes 3 to 7 business days. Express shipping costs 15 dollars." },
]);

const ex = (question: string, answer: string): Exchange => ({ conversationId: "c1", turnIndex: 1, question, answer });

describe("heuristic judge", () => {
  it("accepts a grounded answer", () => {
    const g = heuristicGrade(ex("How long does shipping take?", "Standard shipping takes 3 to 7 business days."), kb);
    expect(g.verdict).toBe("correct");
    expect(g.sourceDoc).toBe("Shipping");
  });

  it("flags invented numbers as hallucination", () => {
    const g = heuristicGrade(ex("How much is express shipping?", "Express shipping costs 49 dollars and arrives in 1 day."), kb);
    expect(g.verdict).toBe("hallucination");
    expect(g.severity).toBe("high");
  });

  it("flags a missed escalation", () => {
    const g = heuristicGrade(ex("I want a refund now or I will call my lawyer", "Have a great day!"), kb);
    expect(g.verdict).toBe("should_escalate");
  });

  it("accepts a proper escalation", () => {
    const g = heuristicGrade(ex("I want to speak to a human", "I'm connecting you to a team member now."), kb);
    expect(g.verdict).not.toBe("should_escalate");
  });

  it("flags over-promising", () => {
    const g = heuristicGrade(ex("Will it arrive tomorrow?", "Yes, we guarantee it arrives tomorrow, 100%."), kb);
    expect(g.verdict).toBe("off_policy");
  });

  it("returns unclear when there is no knowledge base", () => {
    const g = heuristicGrade(ex("What is your return window?", "It is 30 days."), buildKbIndex([]));
    expect(g.verdict).toBe("unclear");
  });
});

describe("features", () => {
  it("produces a vector matching the feature names, with values in range", () => {
    const s = signalsFor(ex("refund?", "You can get a refund within 30 days."), kb);
    const v = featureVector(s, "correct", 0.8);
    expect(v).toHaveLength(FEATURE_NAMES.length);
    v.forEach((x) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    });
  });
});

describe("exchanges", () => {
  it("pairs each bot reply with the customer messages before it", () => {
    const list = exchangesOf({
      id: "a",
      turns: [
        { role: "assistant", content: "Hi! How can I help?" },
        { role: "user", content: "Order late" },
        { role: "user", content: "It's been 2 weeks" },
        { role: "assistant", content: "Sorry, let me check." },
      ],
    });
    expect(list).toHaveLength(2);
    expect(list[1].question).toBe("Order late\nIt's been 2 weeks");
    expect(list[1].turnIndex).toBe(3);
  });
});

describe("prior risk", () => {
  it("ranks confident bad verdicts above confident good ones", () => {
    expect(priorRisk("hallucination", 0.9)).toBeGreaterThan(priorRisk("correct", 0.9));
    expect(priorRisk("correct", 0.2)).toBeGreaterThan(priorRisk("correct", 0.9));
  });
});
