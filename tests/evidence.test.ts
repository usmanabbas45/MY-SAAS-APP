import { beforeEach, describe, expect, it } from "vitest";
import { POST as checkPost } from "@/app/api/v1/check/route";
import { get, run } from "@/lib/db";
import { bestSentence, diagnose, verifyQuote } from "@/lib/judge/evidence";
import { freshDb } from "./helpers";

const docs = [
  { title: "Returns & refunds", content: "You can return any item within 30 days.\nSale items can be returned for store credit only, not a refund. Refunds take up to 5 business days." },
  { title: "Shipping", content: "Express shipping costs 15 dollars and takes 2 business days." },
];

describe("verifyQuote", () => {
  it("keeps a quote that appears word for word, ignoring case, spacing and curly quotes", () => {
    expect(verifyQuote("sale items can be returned for  store credit only, not a refund.", docs)).toEqual({
      quote: "sale items can be returned for  store credit only, not a refund.", doc: "Returns & refunds",
    });
    expect(verifyQuote("“Express shipping costs 15 dollars”", docs)?.doc).toBe("Shipping");
  });

  it("drops quotes the AI made up or paraphrased, and tiny fragments", () => {
    expect(verifyQuote("Sale items get a full refund within 30 days.", docs)).toBeNull();
    expect(verifyQuote("refund", docs)).toBeNull();
    expect(verifyQuote(null, docs)).toBeNull();
  });
});

describe("bestSentence", () => {
  it("picks the sentence of the related doc that matches the question and answer", () => {
    expect(bestSentence(docs[0], "Can I return a sale item for a refund?", "Yes, sale items get a full refund.")).toBe(
      "Sale items can be returned for store credit only, not a refund.",
    );
  });

  it("quotes the rule the answer broke, not the sentence a wrong answer echoes", () => {
    const doc = { title: "Returns & refunds", content: "You can return any item within 30 days of delivery for a full refund. Sale items can be returned for store credit only, not a refund." };
    expect(bestSentence(doc, "Can I return a sale item for a refund?", "Yes, all items including sale items get a full refund within 30 days.",
      "The article says sale items can be returned for store credit only.")).toBe("Sale items can be returned for store credit only, not a refund.");
  });

  it("returns null when nothing in the doc is close", () => {
    expect(bestSentence(docs[1], "Do you sell gift cards?", "Yes we do.")).toBeNull();
    expect(bestSentence(undefined, "q", "a")).toBeNull();
  });
});

describe("retrieval vs generation diagnosis", () => {
  const ev = "Sale items can be returned for store credit only, not a refund.";
  it("blames generation when the bot had the right fact", () => {
    expect(diagnose("hallucination", ev, ["Returns: ... Sale items can be returned for store credit only, not a refund. ..."])).toBe("generation");
    expect(diagnose("hallucination", ev, ["sale items: returned for store credit only (not refund)"])).toBe("generation");
  });
  it("blames retrieval when the fact wasn't in what the bot fetched", () => {
    expect(diagnose("hallucination", ev, ["Express delivery costs £7.99 and arrives the next business day."])).toBe("retrieval");
  });
  it("points to missing docs, and stays silent without chunks or for correct answers", () => {
    expect(diagnose("unsupported", null, ["anything"])).toBe("docs");
    expect(diagnose("hallucination", ev, undefined)).toBeNull();
    expect(diagnose("correct", ev, ["x"])).toBeNull();
  });
});

describe("evidence on live checks", () => {
  let projectId: number;
  beforeEach(() => {
    ({ projectId } = freshDb());
    run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 'Shipping', 'Express shipping costs 15 dollars and takes 2 business days. Standard shipping is free.')", projectId);
  });

  it("returns and stores the supporting sentence from the help docs", async () => {
    const res = await checkPost(new Request("http://x/api/v1/check", {
      method: "POST", headers: { authorization: "Bearer ap_live_test" },
      body: JSON.stringify({ question: "How much is express shipping?", answer: "Express shipping costs 15 dollars." }),
    }));
    const body = await res.json();
    expect(body.evidence).toBe("Express shipping costs 15 dollars and takes 2 business days.");
    expect(get<{ evidence: string }>("SELECT evidence FROM audit_items ORDER BY id DESC LIMIT 1")?.evidence).toBe(body.evidence);
  });

  it("diagnoses a wrong answer from the chunks the bot retrieved, without storing them", async () => {
    const res = await checkPost(new Request("http://x/api/v1/check", {
      method: "POST", headers: { authorization: "Bearer ap_live_test" },
      body: JSON.stringify({ question: "How much is express shipping?", answer: "Express shipping costs 45 dollars.", retrieved: ["Our returns policy: 30 days."], trace_id: "req-1" }),
    }));
    const body = await res.json();
    expect(body.decision).not.toBe("allow");
    expect(body.diagnosis).toBe("retrieval");
    const row = get<{ diagnosis: string; trace_id: string }>("SELECT diagnosis, trace_id FROM audit_items ORDER BY id DESC LIMIT 1");
    expect(row).toEqual({ diagnosis: "retrieval", trace_id: "req-1" });
  });
});
