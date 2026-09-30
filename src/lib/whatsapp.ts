import { get, run } from "./db";
import { sha256 } from "./security";

/**
 * WhatsApp live monitoring: customers point their own WAHA server's webhook at ProofMyAI; incoming and
 * outgoing messages are paired into question/answer events for live tracking.
 */

// ---------- Live monitoring from a WAHA webhook ----------

export interface WahaEvent {
  event?: string;
  session?: string;
  payload?: { id?: string; timestamp?: number; from?: string; to?: string; fromMe?: boolean; body?: string; hasMedia?: boolean };
}

/** Customer phone numbers never become conversation ids: they are hashed. */
export const chatKey = (chatId: string) => `wa-${sha256(`wa:${chatId}`).slice(0, 12)}`;

export type LiveEvent = { conversation_id: string; bot_name: string; question?: string; answer?: string; latency_ms?: number };

/**
 * Turns one WAHA webhook event into a live-tracking event:
 * customer message → { question } (starts the missing-reply clock), bot message → { question, answer }.
 * Returns null for events to ignore (groups, status updates, empty messages, other event types).
 */
export function wahaToLiveEvent(projectId: number, e: WahaEvent, nowMs = Date.now()): LiveEvent | null {
  if (e.event !== "message" && e.event !== "message.any") return null;
  const m = e.payload;
  if (!m) return null;
  const chat = m.fromMe ? m.to : m.from;
  if (!chat || /@(g\.us|broadcast|newsletter)$/.test(chat) || chat === "status@broadcast") return null;
  const text = m.body?.trim() || (m.hasMedia ? "[media message]" : "");
  if (!text) return null;
  const at = m.timestamp ? m.timestamp * 1000 : nowMs;
  const conversation_id = chatKey(chat);
  const bot_name = `WhatsApp${e.session && e.session !== "default" ? ` (${e.session})` : ""}`;
  if (!m.fromMe) {
    run(
      "INSERT INTO wa_last_question (project_id, chat, question, at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, chat) DO UPDATE SET question = excluded.question, at_ms = excluded.at_ms",
      projectId, conversation_id, text.slice(0, 20000), at,
    );
    return { conversation_id, bot_name, question: text };
  }
  const q = get<{ question: string; at_ms: number }>("SELECT question, at_ms FROM wa_last_question WHERE project_id = ? AND chat = ?", projectId, conversation_id);
  return {
    conversation_id, bot_name, question: q?.question ?? "", answer: text,
    ...(q && at >= q.at_ms && at - q.at_ms < 3_600_000 ? { latency_ms: at - q.at_ms } : {}),
  };
}
