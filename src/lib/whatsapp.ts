import { get, run } from "./db";
import { sha256 } from "./security";

/**
 * WhatsApp support, two parts:
 * 1. Tests by number: ProofMyAI's own WhatsApp number (through a WAHA server) messages a customer's bot
 *    like a real customer and reads the reply. Needs WAHA_URL, WAHA_API_KEY and optionally WAHA_SESSION.
 * 2. Live monitoring: customers point their own WAHA server's webhook at ProofMyAI; incoming and outgoing
 *    messages are paired into question/answer events.
 */

export const wahaConfigured = () => Boolean(process.env.WAHA_URL?.trim() && process.env.WAHA_API_KEY?.trim());
const wahaUrl = () => process.env.WAHA_URL!.trim().replace(/\/+$/, "");
const session = () => process.env.WAHA_SESSION?.trim() || "default";
export const DAILY_LIMIT = () => Number(process.env.WHATSAPP_DAILY_LIMIT) || 200;
/** WhatsApp runs use at most this many questions, to keep message volume low. */
export const MAX_WA_QUESTIONS = 10;

type Fetcher = typeof fetch;

/** "+92 343-1234567" → "923431234567". Returns null unless it looks like an international number. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "").replace(/^00/, "+").replace(/^\+/, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

async function waha(path: string, init: RequestInit = {}, fetcher: Fetcher = fetch): Promise<unknown> {
  const res = await fetcher(`${wahaUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", accept: "application/json", "X-Api-Key": process.env.WAHA_API_KEY!.trim(), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WhatsApp gateway answered HTTP ${res.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

/** Checks the number is on WhatsApp and returns the chat id to use. */
export async function whatsappChatId(phone: string, fetcher?: Fetcher): Promise<string> {
  const r = (await waha(`/api/contacts/check-exists?phone=${phone}&session=${encodeURIComponent(session())}`, {}, fetcher)) as { numberExists?: boolean; chatId?: string };
  if (!r?.numberExists) throw new Error(`+${phone} is not on WhatsApp.`);
  return r.chatId || `${phone}@c.us`;
}

function takeDailyQuota(n = 1, day = new Date().toISOString().slice(0, 10)): boolean {
  const used = get<{ count: number }>("SELECT count FROM wa_sends WHERE day = ?", day)?.count ?? 0;
  if (used + n > DAILY_LIMIT()) return false;
  run("INSERT INTO wa_sends (day, count) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET count = count + excluded.count", day, n);
  return true;
}

interface WahaMessage { id?: string; timestamp?: number; fromMe?: boolean; body?: string; hasMedia?: boolean }

// One WhatsApp conversation at a time across the whole server: fewer bursts, lower ban risk.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export interface AskOptions { fetcher?: Fetcher; timeoutMs?: number; quietMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> }
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sends one question to the bot's WhatsApp number and returns its reply. Several quick messages from the
 * bot are joined. Throws when the bot doesn't answer within the timeout (the test then fails, which is
 * exactly what the customer wants to know).
 */
export function askWhatsApp(phone: string, question: string, opts: AskOptions = {}): Promise<string> {
  return serial(async () => {
    const { fetcher, timeoutMs = 60000, quietMs = 6000, pollMs = 2500, sleep = realSleep } = opts;
    if (!wahaConfigured()) throw new Error("WhatsApp testing is not set up on this server.");
    if (!takeDailyQuota()) throw new Error("Daily WhatsApp test limit reached. Tests continue tomorrow.");
    const chatId = await whatsappChatId(phone, fetcher);
    const sentAt = Math.floor(Date.now() / 1000) - 1;
    await waha("/api/sendText", { method: "POST", body: JSON.stringify({ session: session(), chatId, text: question }) }, fetcher);
    const started = Date.now();
    let replies: WahaMessage[] = [];
    let lastNew = 0;
    while (Date.now() - started < timeoutMs) {
      await sleep(pollMs);
      const msgs = (await waha(`/api/${encodeURIComponent(session())}/chats/${encodeURIComponent(chatId)}/messages?limit=20&downloadMedia=false`, {}, fetcher)) as WahaMessage[];
      const fresh = (Array.isArray(msgs) ? msgs : []).filter((m) => !m.fromMe && (m.timestamp ?? 0) >= sentAt);
      if (fresh.length > replies.length) { replies = fresh; lastNew = Date.now(); }
      if (replies.length && Date.now() - lastNew >= quietMs) break;
    }
    if (!replies.length) throw new Error(`The bot did not reply on WhatsApp within ${Math.round(timeoutMs / 1000)} seconds.`);
    return replies
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      .map((m) => (m.body?.trim() || (m.hasMedia ? "[media message]" : ""))).filter(Boolean).join("\n");
  });
}

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
