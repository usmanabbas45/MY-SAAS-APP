import { processLiveChat } from "../audit/live";
import { limitError, projectOwner } from "../billing";
import { all, get, run } from "../db";
import { decrypt, safeFetch, sha256 } from "../security";
import { truncate } from "../text";

/**
 * Read-only Twilio connector (WhatsApp and SMS bots). Every 15 minutes it reads the account's message
 * log, pairs each customer message with the bot's reply, and feeds them into live tracking: answers are
 * graded, response times recorded, failed deliveries flagged, and messages the bot never answered alerted.
 * Nothing is ever sent through Twilio.
 */
export interface ChatSource {
  id: number;
  project_id: number;
  platform: string;
  name: string;
  account_id: string; // Twilio Account SID (AC...)
  secret_enc: string; // encrypted JSON { keySid?: string; secret: string }
  bot_address: string; // the bot's number, e.g. whatsapp:+14155238886
  cursor: string | null;
  last_polled_at: string | null;
  last_error: string | null;
}

interface TwilioMessage {
  sid: string;
  body: string | null;
  from: string;
  to: string;
  direction: string; // inbound | outbound-api | outbound-reply | outbound-call
  status: string;
  date_sent: string | null;
  date_created: string | null;
  error_code: number | null;
  error_message?: string | null;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const normaliseAddress = (a: string) => a.trim().toLowerCase().replace(/\s+/g, "");

/** Customer identity is never stored: conversations are keyed by a hash of the customer's number. */
export const conversationIdFor = (customer: string) => `tw-${sha256(normaliseAddress(customer)).slice(0, 12)}`;

export async function fetchTwilioMessages(src: ChatSource, since: Date, fetcher: Fetcher = safeFetch): Promise<TwilioMessage[]> {
  const creds = JSON.parse(decrypt(src.secret_enc)) as { keySid?: string; secret: string };
  const auth = Buffer.from(`${creds.keySid || src.account_id}:${creds.secret}`).toString("base64");
  const day = since.toISOString().slice(0, 10);
  let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(src.account_id)}/Messages.json?PageSize=200&DateSent%3E=${day}`;
  const out: TwilioMessage[] = [];
  for (let page = 0; url && page < 10; page++) {
    const res = await fetcher(url, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
    const data = (await res.json().catch(() => ({}))) as { messages?: TwilioMessage[]; next_page_uri?: string | null; message?: string };
    if (!res.ok) throw new Error(res.status === 401 ? "Twilio rejected the Account SID / key. Check them and try again." : `Twilio: ${data.message ?? `HTTP ${res.status}`}`);
    out.push(...(data.messages ?? []));
    url = data.next_page_uri ? `https://api.twilio.com${data.next_page_uri}` : null;
  }
  return out;
}

const when = (m: TwilioMessage) => Date.parse(m.date_sent ?? m.date_created ?? "");

/** Reads new messages since the last poll and feeds them into live tracking. */
export async function pollChatSource(src: ChatSource, fetcher: Fetcher = safeFetch): Promise<{ replies: number; waiting: number; error: string | null }> {
  const project = get<{ id: number; redact_pii: number; mask_terms: string | null }>("SELECT id, redact_pii, mask_terms FROM projects WHERE id = ?", src.project_id);
  if (!project) return { replies: 0, waiting: 0, error: "Project not found" };
  const cursor = src.cursor ? Date.parse(src.cursor) : Date.now() - 86400000; // first connection: last 24 hours
  const bot = normaliseAddress(src.bot_address);
  let replies = 0, waiting = 0, newest = cursor;
  try {
    const messages = (await fetchTwilioMessages(src, new Date(cursor), fetcher))
      .filter((m) => Number.isFinite(when(m)) && when(m) > cursor && m.date_sent)
      .filter((m) => normaliseAddress(m.from) === bot || normaliseAddress(m.to) === bot)
      .sort((a, b) => when(a) - when(b));

    const byCustomer = new Map<string, TwilioMessage[]>();
    for (const m of messages) {
      const customer = m.direction === "inbound" ? m.from : m.to;
      byCustomer.set(customer, [...(byCustomer.get(customer) ?? []), m]);
    }
    const owner = projectOwner(project.id);
    for (const [customer, msgs] of byCustomer) {
      const conversation_id = conversationIdFor(customer);
      let asked: string[] = [];
      let firstAsk: number | null = null, lastAsk: number | null = null, error: string | undefined;
      for (const m of msgs) {
        newest = Math.max(newest, when(m));
        if (m.direction === "inbound") {
          asked.push(m.body ?? "");
          firstAsk ??= when(m);
          lastAsk = when(m);
          continue;
        }
        if (m.status === "failed" || m.status === "undelivered") {
          // The bot tried to answer but the customer never got it: keep waiting, remember why.
          error = `Twilio delivery ${m.status}${m.error_code ? ` (error ${m.error_code})` : ""}`;
          continue;
        }
        if (limitError(owner, "conversations")) throw new Error("Your plan's monthly conversation limit is reached; upgrade to keep tracking.");
        if (!asked.length) {
          // The customer's message arrived in an earlier poll and is waiting in pending_replies.
          const p = get<{ question: string; received_at: string }>("SELECT question, received_at FROM pending_replies WHERE project_id = ? AND conversation_id = ?", project.id, conversation_id);
          if (p && !p.question.startsWith("(not stored")) asked = [p.question];
          if (p) lastAsk = Date.parse(p.received_at);
        }
        await (await processLiveChat(project, {
          conversation_id, question: asked.join("\n"), answer: m.body ?? "",
          latency_ms: lastAsk != null ? Math.max(0, when(m) - lastAsk) : undefined,
        }, { wait: true })).grades;
        replies++;
        asked = [];
        firstAsk = lastAsk = null;
        error = undefined;
      }
      if (asked.length && firstAsk != null) {
        await processLiveChat(project, { conversation_id, question: asked.join("\n"), error }, { receivedAt: new Date(firstAsk).toISOString() });
        waiting++;
      }
    }
    run("UPDATE chat_sources SET cursor = ?, last_polled_at = ?, last_error = NULL WHERE id = ?", new Date(newest).toISOString(), new Date().toISOString(), src.id);
    return { replies, waiting, error: null };
  } catch (err) {
    const error = truncate(err instanceof Error ? err.message : String(err), 300);
    run("UPDATE chat_sources SET cursor = ?, last_polled_at = ?, last_error = ? WHERE id = ?", new Date(newest).toISOString(), new Date().toISOString(), error, src.id);
    return { replies, waiting, error };
  }
}

export async function pollAllChatSources(): Promise<number> {
  const sources = all<ChatSource>("SELECT * FROM chat_sources");
  for (const s of sources) await pollChatSource(s);
  return sources.length;
}
