import { beforeEach, describe, expect, it } from "vitest";
import { gradeLiveChat, LiveChatSchema, newExchanges, redactChat } from "@/lib/audit/live";
import { createAudit, executeAudit } from "@/lib/audit/run";
import { csvCell } from "@/lib/csv";
import { all, get, run } from "@/lib/db";
import { digestText, sendDueDigests } from "@/lib/digest";
import { heuristicGrade } from "@/lib/judge/heuristic";
import { buildKbIndex } from "@/lib/judge/features";
import { redactConversations, redactPII } from "@/lib/pii";
import { applyRules, type Rule } from "@/lib/rules";
import { isFrustrated } from "@/lib/sentiment";
import { freshDb } from "./helpers";

describe("personal data masking", () => {
  it("masks emails, cards, IBANs, phones and IPs", () => {
    const out = redactPII("Mail jane.doe@acme.com, card 4111 1111 1111 1111, IBAN DE89 3704 0044 0532 0130 00, call +44 20 7946 0958 or 0300-1234567, ip 192.168.1.20");
    expect(out).toBe("Mail [email], card [card], IBAN [iban], call [phone] or [phone], ip [ip]");
  });

  it("keeps prices, dates, order sizes and non-card long numbers intact", () => {
    const text = "Express costs $15 or 49 dollars, arrives in 3 to 7 days, on 2026-09-27, 30% off, qty 12, ref 1234 5678 9012 3456";
    expect(redactPII(text)).toBe(text.replace("1234 5678 9012 3456", "1234 5678 9012 3456"));
    expect(redactPII("Order #12345678")).toBe("Order #12345678");
  });

  it("masks whole conversations and live events", () => {
    const [c] = redactConversations([{ id: "1", turns: [{ role: "user", content: "I'm bob@x.io" }, { role: "assistant", content: "Hi" }] }]);
    expect(c.turns[0].content).toBe("I'm [email]");
    const chat = redactChat(LiveChatSchema.parse({ conversation_id: "1", question: "my email a@b.co", answer: "ok a@b.co" }));
    expect(chat).toMatchObject({ question: "my email [email]", answer: "ok [email]" });
  });
});

describe("frustration detection", () => {
  it.each([
    ["This is ridiculous, still waiting for my order", true],
    ["WHERE IS MY ORDER I PAID TWO WEEKS AGO", true],
    ["Hello???!!", true],
    ["How long does shipping take?", false],
    ["Thanks, that helps!", false],
    ["", false],
  ])("%s → %s", (text, expected) => expect(isFrustrated(text)).toBe(expected));
});

describe("custom rules", () => {
  const index = buildKbIndex([{ title: "Shipping", content: "Standard shipping takes 3 to 7 business days." }]);
  const rules: Rule[] = [
    { id: 1, kind: "never_say", pattern: "Lifetime Warranty" },
    { id: 2, kind: "must_escalate", pattern: "allergic" },
  ];
  const ex = (question: string, answer: string) => ({ conversationId: "c", turnIndex: 1, question, answer });

  it("flags banned phrases case-insensitively", () => {
    const e = ex("Warranty?", "All products come with a lifetime warranty.");
    const { grade, hit } = applyRules(e, heuristicGrade(e, index), rules);
    expect(grade).toMatchObject({ verdict: "off_policy", severity: "high" });
    expect(hit).toBe("never_say:Lifetime Warranty");
  });

  it("requires a handover for trigger words, and accepts a real handover", () => {
    const bad = ex("I had an allergic reaction", "Sorry to hear that. Anything else?");
    expect(applyRules(bad, heuristicGrade(bad, index), rules).grade.verdict).toBe("should_escalate");
    const good = ex("I had an allergic reaction", "I'm connecting you to a team member right now.");
    expect(applyRules(good, heuristicGrade(good, index), rules).hit).toBeNull();
  });
});

describe("rules, frustration and masking in the pipelines", () => {
  let projectId: number;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    ({ projectId } = freshDb());
    run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 'Shipping', 'Standard shipping takes 3 to 7 business days.')", projectId);
    run("INSERT INTO rules (project_id, kind, pattern) VALUES (?, 'never_say', 'guaranteed')", projectId);
  });

  it("applies rules and frustration flags to uploaded audits", async () => {
    const { id } = createAudit(projectId, "a");
    await executeAudit(id, projectId, [{ id: "1", turns: [
      { role: "user", content: "THIS IS RIDICULOUS WHERE IS MY PARCEL" },
      { role: "assistant", content: "Standard shipping takes 3 to 7 business days, delivery guaranteed." },
    ] }]);
    const item = get<{ verdict: string; rule_hit: string; frustrated: number }>("SELECT verdict, rule_hit, frustrated FROM audit_items WHERE audit_id = ?", id)!;
    expect(item).toEqual({ verdict: "off_policy", rule_hit: "never_say:guaranteed", frustrated: 1 });
  });

  it("applies rules to live answers", async () => {
    const grades = await gradeLiveChat(projectId, newExchanges(projectId, LiveChatSchema.parse({ conversation_id: "x", question: "Shipping?", answer: "Delivery is guaranteed in 3 days." })));
    expect(grades[0].verdict).toBe("off_policy");
  });

  it("builds the weekly digest and only sends when email is configured", async () => {
    run("UPDATE projects SET alert_email = 'owner@shop.com' WHERE id = ?", projectId);
    const text = digestText(projectId, "Test", "https://proofmyai.com");
    expect(text).toContain("AI Health score");
    expect(text).toContain(`https://proofmyai.com/app/p/${projectId}`);
    delete process.env.RESEND_API_KEY;
    expect(await sendDueDigests()).toBe(0);
    expect(get<{ last_digest_at: string | null }>("SELECT last_digest_at FROM projects WHERE id = ?", projectId)?.last_digest_at).toBeNull();
  });
});

describe("CSV export", () => {
  it("quotes cells and neutralises spreadsheet formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
  });
});

describe("database", () => {
  it("has the new columns and rules table", () => {
    freshDb();
    const cols = all<{ name: string }>("PRAGMA table_info(projects)").map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["redact_pii", "report_brand", "weekly_digest", "last_digest_at"]));
    expect(get<{ redact_pii: number }>("SELECT redact_pii FROM projects LIMIT 1")?.redact_pii).toBe(1);
  });
});
