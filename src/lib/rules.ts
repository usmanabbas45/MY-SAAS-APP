import { all } from "./db";
import { ESCALATION_ACTIONS } from "./judge/features";
import type { Exchange, Grade } from "./judge/types";

export const RULE_KINDS = {
  never_say: { label: "Bot must never say", hint: "e.g. a competitor's name, \"lifetime warranty\", \"guaranteed\"" },
  must_escalate: { label: "Always hand over to a human when the customer mentions", hint: "e.g. \"chargeback\", \"allergic\", \"cancel my subscription\"" },
} as const;
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

/** Applies the business's own rules on top of the judge's verdict. A broken rule always wins. */
export function applyRules(ex: Exchange, grade: Grade, rules: Rule[]): { grade: Grade; hit: string | null } {
  for (const r of rules) {
    if (r.kind === "never_say" && contains(ex.answer, r.pattern)) {
      return {
        grade: { ...grade, verdict: "off_policy", severity: "high", confidence: 1, reason: `Broke your rule: the bot must never say “${r.pattern}”.` },
        hit: `never_say:${r.pattern}`,
      };
    }
    if (r.kind === "must_escalate" && contains(ex.question, r.pattern) && !ESCALATION_ACTIONS.test(ex.answer)) {
      return {
        grade: { ...grade, verdict: "should_escalate", severity: "high", confidence: 1, reason: `Broke your rule: when a customer mentions “${r.pattern}”, the bot must hand over to a human.` },
        hit: `must_escalate:${r.pattern}`,
      };
    }
  }
  return { grade, hit: null };
}
