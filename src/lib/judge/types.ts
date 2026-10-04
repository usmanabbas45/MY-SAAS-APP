export const VERDICTS = ["correct", "unsupported", "hallucination", "should_escalate", "off_policy", "unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const SEVERITIES = ["none", "low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  correct: "Correct",
  unsupported: "Not in docs",
  hallucination: "Made up",
  should_escalate: "Should escalate",
  off_policy: "Off policy",
  unclear: "Unclear",
};

export interface KbDoc {
  title: string;
  content: string;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  id: string;
  turns: Turn[];
}

/** One assistant reply paired with the customer message it answered. */
export interface Exchange {
  conversationId: string;
  turnIndex: number;
  question: string;
  answer: string;
  /** Earlier turns of the conversation (before `question`), used for conversation-level checks. */
  context?: Turn[];
}

export interface Grade {
  turnIndex: number;
  verdict: Verdict;
  severity: Severity;
  reason: string;
  sourceDoc: string | null;
  confidence: number;
  /** Short label for what the customer asked about (AI judge only). */
  topic?: string | null;
}

export function exchangesOf(conv: Conversation): Exchange[] {
  const out: Exchange[] = [];
  let lastUser = "";
  let questionStart = 0;
  conv.turns.forEach((t, i) => {
    if (t.role === "user") {
      if (!lastUser) questionStart = i;
      lastUser = lastUser ? `${lastUser}\n${t.content}` : t.content;
    } else if (t.content.trim()) {
      const start = lastUser ? questionStart : i;
      out.push({ conversationId: conv.id, turnIndex: i, question: lastUser, answer: t.content, context: conv.turns.slice(0, start) });
      lastUser = "";
    }
  });
  return out;
}
