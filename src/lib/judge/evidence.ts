import { tokenize } from "../text";
import type { KbDoc } from "./types";

/**
 * Evidence for a verdict: the exact sentence in the business's own help docs that backs it up or that the
 * answer contradicts. A quote from the AI judge is only kept when it really appears in the docs word for word,
 * so the checker can never "make up" evidence; otherwise the closest sentence from the related doc is used.
 */
const MAX = 300;

const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

/** The quote exactly as it appears in a doc (with the doc's title), or null when it isn't in any doc. */
export function verifyQuote(quote: string | null | undefined, docs: KbDoc[]): { quote: string; doc: string } | null {
  const q = norm((quote ?? "").replace(/^["'“‘]+|["'”’]+$/g, "").replace(/\s*(\.\.\.|…)\s*$/, ""));
  if (q.length < 12) return null;
  for (const d of docs) if (norm(d.content).includes(q)) return { quote: clip(quote!.trim().replace(/^["'“‘]+|["'”’]+$/g, "")), doc: d.title };
  return null;
}

function clip(s: string): string {
  return s.length <= MAX ? s : `${s.slice(0, MAX - 1).trimEnd()}…`;
}

const sentences = (text: string) =>
  text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 12 && s.length <= 600);

export type Diagnosis = "retrieval" | "generation" | "docs";

export const DIAGNOSIS_TEXT: Record<Diagnosis, { label: string; text: string }> = {
  retrieval: { label: "Retrieval problem", text: "The right fact is in your help docs, but it wasn't in the text your bot retrieved for this question. Fix search or chunking (which articles get fetched), not the prompt." },
  generation: { label: "Generation problem", text: "Your bot was given the right fact (it was in the retrieved text) and still answered wrongly. Fix the prompt or model, not the docs." },
  docs: { label: "Missing documentation", text: "Your help docs don't cover this, so neither retrieval nor the prompt can fix it. Add an article." },
};

/**
 * Splits a wrong answer into a retrieval failure (the bot never got the right fact) or a generation failure (it had the
 * fact and answered wrongly anyway), using the help-doc evidence and the chunks the bot says it retrieved.
 */
export function diagnose(verdict: string, evidence: string | null | undefined, retrieved: string[] | undefined): Diagnosis | null {
  if (!retrieved?.length || verdict === "correct" || verdict === "should_escalate") return null;
  if (!evidence) return verdict === "unsupported" || verdict === "hallucination" ? "docs" : null;
  const ctx = norm(retrieved.join("\n"));
  const ev = norm(evidence.replace(/…$/, ""));
  if (ctx.includes(ev)) return "generation";
  // The chunk may hold the fact in different words: most of the evidence's words present counts as retrieved.
  const want = stems(evidence);
  const have = stems(retrieved.join(" "));
  let hit = 0;
  want.forEach((w) => { if (have.has(w)) hit++; });
  return want.size && hit / want.size >= 0.8 ? "generation" : "retrieval";
}

/** Crude stem so "item/items" and "return/returned" match. */
const stems = (text: string) => new Set(tokenize(text).map((w) => w.slice(0, 5)));

/**
 * The sentence of the related doc most likely to hold the fact behind the verdict, or null if none is close.
 * The question and the verdict's reason decide the topic; the bot's answer only breaks ties, because a wrong
 * answer echoes the wrong sentence (e.g. "full refund") rather than the rule it broke.
 */
export function bestSentence(doc: KbDoc | undefined, question: string, answer: string, reason = ""): string | null {
  if (!doc) return null;
  const q = stems(question);
  const why = stems(reason);
  const a = stems(answer);
  let best: string | null = null;
  let bestScore = 0;
  for (const s of sentences(doc.content)) {
    const words = stems(s);
    let qHits = 0, rHits = 0, aHits = 0;
    words.forEach((w) => { if (q.has(w)) qHits++; if (why.has(w)) rHits++; if (a.has(w)) aHits++; });
    if (qHits + rHits < 2 && qHits + aHits < 2) continue;
    const score = (3 * qHits + 3 * rHits + aHits) / Math.sqrt(Math.max(1, words.size));
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best ? clip(best) : null;
}
