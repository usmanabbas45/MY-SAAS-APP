import { all } from "./db";
import { ESCALATION_ACTIONS } from "./judge/features";
import type { Exchange, Grade } from "./judge/types";

export const RULE_KINDS = {
  never_say: { label: "Bot must never say", hint: "e.g. a competitor's name, \"lifetime warranty\", \"guaranteed\"" },
  must_escalate: { label: "Always hand over to a human when the customer mentions", hint: "e.g. \"chargeback\", \"allergic\", \"cancel my subscription\"" },
  must_include: { label: "When a topic comes up, the answer must include", hint: "topic => required words, e.g. \"windscreen => not covered\" or \"courtesy car => not available\"" },
} as const;

/** Splits a must_include rule "topic => required text". */
export function parseMustInclude(pattern: string): { topic: string; required: string } | null {
  const [topic, ...rest] = pattern.split("=>");
  const required = rest.join("=>").trim();
  return topic.trim() && required ? { topic: topic.trim(), required } : null;
}
export type RuleKind = keyof typeof RULE_KINDS;

export interface Rule {
  id: number;
  kind: RuleKind;
  pattern: string;
}

export function projectRules(projectId: number): Rule[] {
  return all<Rule>("SELECT id, kind, pattern FROM rules WHERE project_id = ? ORDER BY id", projectId);
}

const contains = (text: string, phrase: string) => text.toLowerCase().includes(phrase.toLowerCase());

const STOPWORDS = new Set(["a", "an", "the", "of", "to", "in", "on", "for", "and", "is", "are", "be", "our", "your", "my", "we", "you", "it", "at", "by", "with", "all"]);

/** Crude English stemmer: "plans"→"plan", "pricing"/"prices"→"pric", "included"→"includ". Good enough for rule matching. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  for (const suf of ["ations", "ation", "ings", "ing", "ies", "es", "ed", "s", "e"]) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) { w = w.slice(0, -suf.length); break; }
  }
  return w;
}

const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}$€£%]+/gu) ?? []);
const stems = (text: string) => new Set(words(text).map(stem));

/** Everyday ways customers and bots refer to common topics. */
const SYNONYMS: Record<string, string[]> = {
  pric: ["price", "pricing", "cost", "costs", "fee", "fees", "charge", "how much", "$", "€", "£", "per month", "a month"],
  plan: ["plan", "subscription", "tier", "package", "membership"],
  refund: ["refund", "money back", "return", "reimburse"],
  deliver: ["delivery", "shipping", "ship", "courier", "dispatch"],
  ship: ["delivery", "shipping", "ship", "courier", "dispatch"],
  cancel: ["cancel", "cancellation", "terminate", "end my"],
  warranty: ["warranty", "guarantee"],
};

/** Does the text mention the phrase? Case-insensitive, any word order and word form, plus common synonyms for one-word topics. */
export function mentions(text: string, phrase: string): boolean {
  if (contains(text, phrase)) return true;
  const need = words(phrase).filter((w) => !STOPWORDS.has(w)).map(stem);
  if (need.length === 0) return false;
  const have = stems(text);
  if (need.every((w) => have.has(w))) return true;
  if (need.length === 1) return (SYNONYMS[need[0]] ?? []).some((syn) => contains(text, syn) || (syn.length > 2 && have.has(stem(syn))));
  return false;
}

/** A topic can list alternatives: "pricing or plans", "refund, return", "windscreen / glass". */
export function topicAlternatives(topic: string): string[] {
  return topic.split(/\s+or\s+|,|\||\//i).map((t) => t.trim()).filter(Boolean);
}

/** Does the answer contain the required statement? Word order and word forms may differ ("VAT is included in the price"). */
export function includesRequired(answer: string, required: string): boolean {
  return topicAlternatives(required).some((alt) => {
    if (contains(answer, alt)) return true;
    const need = words(alt).filter((w) => !STOPWORDS.has(w)).map(stem);
    const have = stems(answer);
    return need.length > 0 && need.every((w) => have.has(w));
  });
}

export interface RuleBreak { kind: RuleKind; pattern: string; reason: string }

/** Checks every rule on its own, independently of the judge's verdict. */
export function ruleBreaks(ex: Exchange, rules: Rule[]): RuleBreak[] {
  const out: RuleBreak[] = [];
  for (const r of rules) {
    if (r.kind === "never_say" && contains(ex.answer, r.pattern)) {
      out.push({ kind: r.kind, pattern: r.pattern, reason: `Broke your rule: the bot must never say “${r.pattern}”.` });
    }
    if (r.kind === "must_escalate" && topicAlternatives(r.pattern).some((t) => mentions(ex.question, t)) && !ESCALATION_ACTIONS.test(ex.answer)) {
      out.push({ kind: r.kind, pattern: r.pattern, reason: `Broke your rule: when a customer mentions “${r.pattern}”, the bot must hand over to a human.` });
    }
    if (r.kind === "must_include") {
      const rule = parseMustInclude(r.pattern);
      if (rule && topicAlternatives(rule.topic).some((t) => mentions(ex.question, t) || mentions(ex.answer, t)) && !includesRequired(ex.answer, rule.required)) {
        out.push({ kind: r.kind, pattern: r.pattern, reason: `Broke your rule: when “${rule.topic}” comes up, the answer must say “${rule.required}”.` });
      }
    }
  }
  return out;
}

/**
 * Applies the business's own rules on top of the judge's verdict. Rules are always evaluated, whatever
 * the judge decided: a "correct" answer that breaks a rule becomes off-policy (or should-escalate), and an
 * answer the judge already flagged keeps its verdict with the rule break added, so neither problem is lost.
 */
export function applyRules(ex: Exchange, grade: Grade, rules: Rule[]): { grade: Grade; hit: string | null; hits: RuleBreak[] } {
  const hits = ruleBreaks(ex, rules);
  if (!hits.length) return { grade, hit: null, hits };
  const reasons = hits.map((h) => h.reason).join(" ");
  const first = hits[0];
  const judgedFine = grade.verdict === "correct" || grade.verdict === "unclear";
  return {
    grade: judgedFine
      ? { ...grade, verdict: first.kind === "must_escalate" ? "should_escalate" : "off_policy", severity: "high", confidence: 1, reason: reasons }
      : { ...grade, severity: "high", reason: `${grade.reason} Also: ${reasons}` },
    hit: hits.map((h) => `${h.kind}:${h.pattern}`).join("\n"),
    hits,
  };
}
