import { z } from "zod";
import { all, get, run, transaction } from "../db";
import { raiseIncident } from "../incidents";
import { buildKbIndex } from "../judge/features";
import { heuristicGrade } from "../judge/heuristic";
import { aiForProject, JudgeError, judgeLabel, llmGradeConversation } from "../judge/llm";
import { exchangesOf, VERDICT_LABELS, type Exchange, type Grade, type Turn } from "../judge/types";
import { loadModel } from "../ml/risk";
import { projectRules } from "../rules";
import { truncate } from "../text";
import { redactPII } from "../pii";
import { normaliseRole } from "./parse";
import { kbDocs, scoreFromSeverities, storeGradedItem } from "./run";

/**
 * Live chatbot monitoring: bots send each conversation (or each new reply) as it happens.
 * New replies are graded straight away and stored in a daily "Live chats" audit, so the
 * fix list, feedback buttons and neural model work on live traffic exactly like on uploads.
 */
export const LiveChatSchema = z
  .object({
    conversation_id: z.string().min(1).max(200),
    bot_name: z.string().max(100).optional(),
    messages: z.array(z.object({ role: z.string().max(40), content: z.string().max(20000) })).min(1).max(300).optional(),
    question: z.string().max(20000).optional(),
    answer: z.string().max(20000).optional(),
  })
  .refine((d) => d.messages || (typeof d.answer === "string" && d.answer.trim() !== ""), {
    message: "Send either messages[] or question + answer",
  });
export type LiveChat = z.infer<typeof LiveChatSchema>;

/** Masks personal data in a live event before anything is stored or sent to the judge. */
export function redactChat(chat: LiveChat, custom: RegExp | null = null): LiveChat {
  return {
    ...chat,
    messages: chat.messages?.map((m) => ({ ...m, content: redactPII(m.content, custom) })),
    question: chat.question === undefined ? undefined : redactPII(chat.question, custom),
    answer: chat.answer === undefined ? undefined : redactPII(chat.answer, custom),
  };
}

export function liveAuditName(date = new Date()): string {
  return `Live chats · ${date.toISOString().slice(0, 10)}`;
}

/** Today's live audit for the project, created on first use. */
export function liveAuditId(projectId: number): number {
  const name = liveAuditName();
  const existing = get<{ id: number }>("SELECT id FROM audits WHERE project_id = ? AND status = 'live' AND name = ?", projectId, name);
  if (existing) return existing.id;
  return run(
    "INSERT INTO audits (project_id, name, mode, status, judge) VALUES (?, ?, ?, 'live', ?)",
    projectId, name, aiForProject(projectId) ? "ai" : "basic", judgeLabel(projectId),
  ).lastInsertRowid;
}

export function toTurns(chat: LiveChat): Turn[] {
  if (chat.messages) {
    return chat.messages.flatMap((m, i) => {
      if (m.role.toLowerCase() === "system") return [];
      const role = normaliseRole(m.role);
      if (!role) throw new Error(`messages[${i}]: unknown role "${m.role}". Use user/customer or assistant/bot.`);
      return [{ role, content: m.content.trim() }];
    });
  }
  return [
    { role: "user", content: (chat.question ?? "").trim() },
    { role: "assistant", content: (chat.answer ?? "").trim() },
  ];
}

/** Replies of this conversation that have not been graded yet (bots may resend the whole history). */
export function newExchanges(projectId: number, chat: LiveChat): Exchange[] {
  const id = chat.bot_name ? `${chat.bot_name}:${chat.conversation_id}` : chat.conversation_id;
  const exchanges = exchangesOf({ id, turns: toTurns(chat) });
  if (!chat.messages) {
    // Single question/answer events: number them after what we already have for this conversation.
    const last = get<{ n: number | null }>(
      `SELECT MAX(i.turn_index) AS n FROM audit_items i JOIN audits a ON a.id = i.audit_id
        WHERE a.project_id = ? AND a.status = 'live' AND i.conversation_id = ?`, projectId, id,
    )?.n;
    return exchanges.map((e) => ({ ...e, turnIndex: (last ?? -1) + 2 }));
  }
  const done = new Set(
    all<{ turn_index: number }>(
      `SELECT i.turn_index FROM audit_items i JOIN audits a ON a.id = i.audit_id
        WHERE a.project_id = ? AND a.status = 'live' AND i.conversation_id = ?`, projectId, id,
    ).map((r) => r.turn_index),
  );
  return exchanges.filter((e) => !done.has(e.turnIndex));
}

/** Grades new replies and stores them. Returns the stored grades. Never throws on judge failures. */
export async function gradeLiveChat(projectId: number, exchanges: Exchange[]): Promise<Grade[]> {
  if (exchanges.length === 0) return [];
  const docs = kbDocs(projectId);
  const index = buildKbIndex(docs);
  let grades: Grade[];
  let note = "";
  if (aiForProject(projectId)) {
    try {
      grades = await llmGradeConversation(exchanges, docs);
    } catch (err) {
      // Live monitoring must keep working when the AI judge is down or over quota.
      grades = exchanges.map((e) => heuristicGrade(e, index));
      note = ` (basic check - AI judge unavailable: ${err instanceof JudgeError ? err.message : "error"})`;
    }
  } else {
    grades = exchanges.map((e) => heuristicGrade(e, index));
  }

  const auditId = liveAuditId(projectId);
  const model = loadModel(projectId);
  const rules = projectRules(projectId);
  transaction(() => {
    grades = exchanges.map((e, i) => storeGradedItem(auditId, e, grades[i], index, model, rules, note));
    const severities = all<{ severity: "none" | "low" | "medium" | "high" }>("SELECT severity FROM audit_items WHERE audit_id = ?", auditId).map((r) => r.severity);
    run("UPDATE audits SET score = ? WHERE id = ?", scoreFromSeverities(severities), auditId);
  });

  for (const [i, g] of grades.entries()) {
    if (g.severity !== "high") continue;
    await raiseIncident(projectId, {
      module: "chatbot", code: `LIVE_${g.verdict.toUpperCase()}`, severity: "high",
      title: `Live chatbot answer flagged: ${VERDICT_LABELS[g.verdict]}`,
      detail: `Customer: “${truncate(exchanges[i].question, 160)}”\nBot: “${truncate(exchanges[i].answer, 200)}”\nWhy: ${g.reason}`,
      dedupeKey: `live-chat:${g.verdict}`,
    });
  }
  return grades;
}
