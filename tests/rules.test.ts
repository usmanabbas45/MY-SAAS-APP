import { beforeEach, describe, expect, it } from "vitest";
import { executeAudit } from "@/lib/audit/run";
import { all, run } from "@/lib/db";
import { applyRules, includesRequired, mentions, topicAlternatives } from "@/lib/rules";
import type { Exchange, Grade } from "@/lib/judge/types";
import { freshDb } from "./helpers";

const ex = (question: string, answer: string): Exchange => ({ conversationId: "c1", turnIndex: 0, question, answer, history: [] } as unknown as Exchange);
const correct: Grade = { verdict: "correct", severity: "none", confidence: 0.9, reason: "The assistant accurately stated the price of the Pro plan using the knowledge base.", sourceDoc: "Pricing" } as Grade;
const vatRule = [{ id: 1, kind: "must_include" as const, pattern: "pricing or plans => Prices include VAT" }];

describe("must-say rules (QA bug 1)", () => {
  it("matches topic alternatives, word forms and synonyms", () => {
    expect(topicAlternatives("pricing or plans")).toEqual(["pricing", "plans"]);
    expect(mentions("How much is the Pro plan?", "plans")).toBe(true);
    expect(mentions("The Pro plan is $29 per month.", "pricing")).toBe(true);
    expect(mentions("What does it cost?", "pricing")).toBe(true);
    expect(mentions("Where is my parcel?", "pricing")).toBe(false);
    expect(includesRequired("All prices include VAT.", "Prices include VAT")).toBe(true);
    expect(includesRequired("VAT is included in the price.", "Prices include VAT")).toBe(true);
    expect(includesRequired("The Pro plan is $29 per month.", "Prices include VAT")).toBe(false);
  });

  it("flags a factually correct answer that omits the required statement (exact QA repro)", () => {
    const r = applyRules(ex("How much is the Pro plan?", "The Pro plan is $29 per month."), correct, vatRule);
    expect(r.hit).toBe("must_include:pricing or plans => Prices include VAT");
    expect(r.grade.verdict).toBe("off_policy");
    expect(r.grade.severity).toBe("high");
    expect(r.grade.reason).toContain("must say “Prices include VAT”");
  });

  it("passes when the statement is there, and ignores unrelated topics", () => {
    expect(applyRules(ex("How much is the Pro plan?", "The Pro plan is $29 per month. Prices include VAT."), correct, vatRule).hit).toBeNull();
    expect(applyRules(ex("Where is my order?", "It ships tomorrow."), correct, vatRule).hit).toBeNull();
  });

  it("is evaluated independently: a made-up answer keeps its verdict and also shows the rule break", () => {
    const madeUp: Grade = { ...correct, verdict: "hallucination", severity: "high", reason: "The KB says $29, not $19." };
    const r = applyRules(ex("How much is the Pro plan?", "The Pro plan is $19 per month."), madeUp, vatRule);
    expect(r.grade.verdict).toBe("hallucination");
    expect(r.hit).not.toBeNull();
    expect(r.grade.reason).toContain("The KB says $29");
    expect(r.grade.reason).toContain("Also: Broke your rule");
  });

  it("reports every broken rule", () => {
    const rules = [...vatRule, { id: 2, kind: "never_say" as const, pattern: "guaranteed" }];
    const r = applyRules(ex("Pro plan price?", "Guaranteed lowest: $29 per month."), correct, rules);
    expect(r.hits).toHaveLength(2);
    expect(r.hit?.split("\n")).toHaveLength(2);
  });
});

describe("end-to-end audit with a must-say rule", () => {
  let projectId: number;
  beforeEach(() => ({ projectId } = freshDb()));

  it("stores the rule break and puts it in the fix list", async () => {
    run("INSERT INTO rules (project_id, kind, pattern) VALUES (?, 'must_include', 'pricing or plans => Prices include VAT')", projectId);
    run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 'Pricing', 'The Pro plan costs $29 per month.')", projectId);
    const auditId = Number(run("INSERT INTO audits (project_id, name, mode, status) VALUES (?, 'QA', 'basic', 'running')", projectId).lastInsertRowid);
    await executeAudit(auditId, projectId, [{ id: "qa-1", turns: [{ role: "user", content: "How much is the Pro plan?" }, { role: "assistant", content: "The Pro plan is $29 per month." }] }]);
    const items = all<{ verdict: string; rule_hit: string | null }>("SELECT verdict, rule_hit FROM audit_items WHERE audit_id = ?", auditId);
    expect(items).toHaveLength(1);
    expect(items[0].rule_hit).toBe("must_include:pricing or plans => Prices include VAT");
    expect(items[0].verdict).not.toBe("correct");
  });
});
