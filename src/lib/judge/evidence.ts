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
