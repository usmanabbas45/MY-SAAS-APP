import { processLiveChat } from "../audit/live";
import { limitError, projectOwner } from "../billing";
import { get, run } from "../db";
import { decrypt, safeFetch } from "../security";
import { truncate } from "../text";
import type { ChatSource } from "./twilio";

/**
 * Read-only Intercom connector for Fin and other Intercom bots. Every 15 minutes it reads conversations
 * updated since the last check and feeds each bot reply (with the customer messages before it) into
 * live tracking. Human (admin) replies are never graded. Nothing is ever written to Intercom.
 * The source stores the region (us | eu | au) in `bot_address` and { token } encrypted in `secret_enc`.
 */
export const INTERCOM_REGIONS = { us: "https://api.intercom.io", eu: "https://api.eu.intercom.io", au: "https://api.au.intercom.io" } as const;
export type IntercomRegion = keyof typeof INTERCOM_REGIONS;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface Author { type?: string; name?: string }
interface Part { part_type?: string; body?: string | null; created_at?: number; author?: Author }
interface IcConversation {
  id: string;
  created_at?: number;
  source?: { body?: string | null; author?: Author };
  conversation_parts?: { conversation_parts?: Part[] };
}

const CUSTOMER = new Set(["user", "lead", "contact"]);
const BOT = new Set(["bot"]);
const HUMAN = new Set(["admin", "team"]);

export const plain = (html: string | null | undefined) =>
  (html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();

function headers(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "Intercom-Version": "2.11" };
}

async function call<T>(fetcher: Fetcher, url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetcher(url, { ...init, headers: headers(token) });
  const data = (await res.json().catch(() => ({}))) as T & { errors?: { message?: string }[] };
  if (!res.ok) {
    if (res.status === 401) throw new Error("Intercom rejected the access token. Create a new one in Intercom → Settings → Integrations → Developer Hub and try again.");
    if (res.status === 403) throw new Error("The Intercom token is missing the \"Read conversations\" permission.");
    throw new Error(`Intercom: ${data.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
  }
  return data;
}

/** Checks the token and returns the workspace name and id. */
export async function verifyIntercom(token: string, region: IntercomRegion, fetcher: Fetcher = safeFetch): Promise<{ appName: string; appId: string }> {
  const me = await call<{ app?: { name?: string; id_code?: string } }>(fetcher, `${INTERCOM_REGIONS[region]}/me`, token);
  return { appName: me.app?.name ?? "Intercom", appId: me.app?.id_code ?? "" };
}

interface Msg { who: "customer" | "bot" | "human"; text: string; at: number }

export function conversationMessages(c: IcConversation): Msg[] {
  const out: Msg[] = [];
  const who = (a?: Author): Msg["who"] | null => (CUSTOMER.has(a?.type ?? "") ? "customer" : BOT.has(a?.type ?? "") ? "bot" : HUMAN.has(a?.type ?? "") ? "human" : null);
  const first = who(c.source?.author);
  if (first && plain(c.source?.body)) out.push({ who: first, text: plain(c.source?.body), at: c.created_at ?? 0 });
  for (const p of c.conversation_parts?.conversation_parts ?? []) {
    const w = who(p.author);
    const text = plain(p.body);
    if (!w || !text || (p.part_type && !["comment", "open", "close", "assignment", "quick_reply"].includes(p.part_type))) continue;
    out.push({ who: w, text, at: p.created_at ?? 0 });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Reads conversations updated since the last poll and feeds new bot replies into live tracking. */
export async function pollIntercomSource(src: ChatSource, fetcher: Fetcher = safeFetch): Promise<{ replies: number; waiting: number; error: string | null }> {
  const project = get<{ id: number; redact_pii: number; mask_terms: string | null }>("SELECT id, redact_pii, mask_terms FROM projects WHERE id = ?", src.project_id);
  if (!project) return { replies: 0, waiting: 0, error: "Project not found" };
  const base = INTERCOM_REGIONS[(src.bot_address as IntercomRegion) in INTERCOM_REGIONS ? (src.bot_address as IntercomRegion) : "us"];
  const since = src.cursor ? Math.floor(Date.parse(src.cursor) / 1000) : Math.floor(Date.now() / 1000) - 86400; // first connection: last 24 hours
  let newest = since, replies = 0, waiting = 0;
  try {
    const { token } = JSON.parse(decrypt(src.secret_enc)) as { token: string };
    const ids: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = await call<{ conversations?: { id: string }[]; pages?: { next?: { starting_after?: string } } }>(fetcher, `${base}/conversations/search`, token, {
        method: "POST",
        body: JSON.stringify({ query: { field: "updated_at", operator: ">", value: since }, pagination: { per_page: 50, ...(after ? { starting_after: after } : {}) } }),
      });
      ids.push(...(r.conversations ?? []).map((c) => c.id));
      after = r.pages?.next?.starting_after;
      if (!after) break;
    }
    const owner = projectOwner(project.id);
    for (const id of ids) {
      const conv = await call<IcConversation>(fetcher, `${base}/conversations/${encodeURIComponent(id)}?display_as=plaintext`, token);
      const msgs = conversationMessages(conv);
      const conversation_id = `ic-${id}`;
      let asked: Msg[] = [];
      for (const m of msgs) {
        newest = Math.max(newest, m.at);
        if (m.who === "customer") { asked.push(m); continue; }
        if (m.who === "human") { asked = []; continue; } // a person answered: not graded, no longer waiting
        if (m.at <= since) { asked = []; continue; } // bot reply already checked in an earlier poll
        if (limitError(owner, "conversations")) throw new Error("Your plan's monthly conversation limit is reached; upgrade to keep tracking.");
        const lastAsk = asked.length ? asked[asked.length - 1].at : null;
        await (await processLiveChat(project, {
          conversation_id, question: asked.map((a) => a.text).join("\n"), answer: m.text,
          latency_ms: lastAsk != null ? Math.max(0, (m.at - lastAsk) * 1000) : undefined,
        }, { wait: true })).grades;
        replies++;
        asked = [];
      }
      const unanswered = asked.filter((a) => a.at > since);
      if (unanswered.length) {
        await processLiveChat(project, { conversation_id, question: unanswered.map((a) => a.text).join("\n") }, { receivedAt: new Date(unanswered[0].at * 1000).toISOString() });
        waiting++;
      }
    }
    run("UPDATE chat_sources SET cursor = ?, last_polled_at = ?, last_error = NULL WHERE id = ?", new Date(newest * 1000).toISOString(), new Date().toISOString(), src.id);
    return { replies, waiting, error: null };
  } catch (err) {
    const error = truncate(err instanceof Error ? err.message : String(err), 300);
    run("UPDATE chat_sources SET cursor = ?, last_polled_at = ?, last_error = ? WHERE id = ?", new Date(newest * 1000).toISOString(), new Date().toISOString(), error, src.id);
    return { replies, waiting, error };
  }
}
