import { bestDoc, signalsFor, type KbIndex } from "./features";
import type { Exchange, Grade } from "./types";

/**
 * Rule-based judge used when no ANTHROPIC_API_KEY is configured ("basic mode").
 * It cannot understand meaning the way an LLM does, so confidences are kept modest;
 * the neural risk model re-scores its output once the customer has labelled examples.
 */
export function heuristicGrade(ex: Exchange, index: KbIndex): Grade {
  const s = signalsFor(ex, index);
  const source = bestDoc(index, ex.question).title;
  const base = { turnIndex: ex.turnIndex, sourceDoc: source };

  if (s.escalationNeeded && !s.escalated && !s.refusal) {
    return { ...base, verdict: "should_escalate", severity: "high", confidence: 0.6,
      reason: "The customer raised a sensitive issue (refund, complaint, legal, safety) and the bot did not hand over to a human." };
  }
  if (s.overpromise) {
    return { ...base, verdict: "off_policy", severity: "medium", confidence: 0.5,
      reason: "The answer makes absolute promises (guarantee, always, 100%) that support bots should not make." };
  }
  if (index.docs.length === 0) {
    return { ...base, verdict: "unclear", severity: "low", confidence: 0.2,
      reason: "No knowledge base uploaded, so the answer cannot be checked against your docs." };
  }
  if (s.unknownNumberRatio >= 0.5 && s.answerLength > 3) {
    return { ...base, verdict: "hallucination", severity: "high", confidence: 0.6,
      reason: "The answer states numbers (prices, dates, limits) that do not appear anywhere in your knowledge base." };
  }
  if (s.refusal) {
    return s.questionCoverage >= 0.5
      ? { ...base, verdict: "unsupported", severity: "medium", confidence: 0.5,
          reason: "The bot said it could not help, but your docs do cover this topic. Check retrieval or bot instructions." }
      : { ...base, verdict: "correct", severity: "none", confidence: 0.5,
          reason: "The bot declined a question your docs do not cover, which is the safe behaviour." };
  }
  if (s.grounding < 0.35 && s.answerLength > 8) {
    return { ...base, verdict: "hallucination", severity: "high", confidence: 0.45,
      reason: "Most of the answer's content does not appear in your knowledge base." };
  }
  if (s.grounding < 0.6) {
    return { ...base, verdict: "unsupported", severity: "medium", confidence: 0.4,
      reason: "Parts of the answer are not backed by your knowledge base." };
  }
  if (s.hedging) {
    return { ...base, verdict: "unclear", severity: "low", confidence: 0.4,
      reason: "The answer is grounded but hedges (\"I think\", \"maybe\"), which erodes customer trust." };
  }
  return { ...base, verdict: "correct", severity: "none", confidence: Math.min(0.85, 0.4 + s.grounding / 2),
    reason: "The answer is consistent with your knowledge base." };
}
