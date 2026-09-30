import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anonymiseConversationId } from "@/lib/audit/live";
import { all, get, run } from "@/lib/db";
import { askWhatsApp, chatKey, normalisePhone, wahaToLiveEvent } from "@/lib/whatsapp";
import { POST as wahaWebhook } from "@/app/api/v1/whatsapp/waha/route";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => {
  ({ projectId } = freshDb());
  Object.assign(process.env, { WAHA_URL: "https://waha.test", WAHA_API_KEY: "k" });
});
afterEach(() => {
  delete process.env.WAHA_URL; delete process.env.WAHA_API_KEY; delete process.env.WHATSAPP_DAILY_LIMIT;
});

describe("phone numbers", () => {
  it("normalises international numbers", () => {
    expect(normalisePhone("+92 343-1234567")).toBe("923431234567");
    expect(normalisePhone("0092 343 1234567")).toBe("923431234567");
    expect(normalisePhone("12345")).toBeNull();
  });
  it("never uses a customer's number as a conversation id", () => {
    expect(anonymiseConversationId("923431234567")).toMatch(/^tel-[a-f0-9]{12}$/);
    expect(anonymiseConversationId("923431234567@c.us")).toMatch(/^tel-/);
    expect(anonymiseConversationId("+92 343 1234567")).toBe(anonymiseConversationId("+92-343-1234567"));
    expect(anonymiseConversationId("chat-8841")).toBe("chat-8841");
  });
});

function fakeWaha(replies: { body: string; delayPolls: number }[]) {
  let polls = 0;
  let sentAt = 0;
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url.replace("https://waha.test", "")}`);
    if (url.includes("check-exists")) return Response.json({ numberExists: true, chatId: "923001112233@c.us" });
    if (url.endsWith("/api/sendText")) { sentAt = Math.floor(Date.now() / 1000); return Response.json({ id: "sent" }); }
    polls++;
    return Response.json([
      { fromMe: true, body: "question", timestamp: sentAt },
      ...replies.filter((r) => polls > r.delayPolls).map((r) => ({ fromMe: false, body: r.body, timestamp: sentAt + 1 })),
    ]);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}
const fast = { sleep: async () => {}, pollMs: 0, quietMs: 0 };

describe("testing a bot by WhatsApp number", () => {
  it("sends the question and joins the bot's replies", async () => {
    const w = fakeWaha([{ body: "Shipping is €9.90.", delayPolls: 1 }, { body: "Anything else?", delayPolls: 1 }]);
    const answer = await askWhatsApp("923001112233", "How much is shipping?", { ...fast, fetcher: w.fetcher, timeoutMs: 5000 });
    expect(answer).toBe("Shipping is €9.90.\nAnything else?");
    expect(w.calls[1]).toBe("POST /api/sendText");
  });

  it("fails clearly when the bot never replies, and respects the daily limit", async () => {
    const w = fakeWaha([]);
    await expect(askWhatsApp("923001112233", "Hi", { sleep: async () => {}, pollMs: 0, fetcher: w.fetcher, timeoutMs: 30 })).rejects.toThrow(/did not reply/);
    process.env.WHATSAPP_DAILY_LIMIT = "1";
    await expect(askWhatsApp("923001112233", "Hi", { ...fast, fetcher: fakeWaha([{ body: "x", delayPolls: 0 }]).fetcher })).rejects.toThrow(/Daily WhatsApp test limit/);
  });
});

describe("live monitoring from a WAHA webhook", () => {
  const ev = (fromMe: boolean, body: string, ts: number, chat = "923009998877@c.us") =>
    ({ event: "message.any", session: "default", payload: { fromMe, body, timestamp: ts, from: fromMe ? "me@c.us" : chat, to: fromMe ? chat : "me@c.us" } });

  it("pairs the customer message with the bot's reply and measures reply time", () => {
    const q = wahaToLiveEvent(projectId, ev(false, "Do you deliver to Lahore?", 1000));
    expect(q).toEqual({ conversation_id: chatKey("923009998877@c.us"), bot_name: "WhatsApp", question: "Do you deliver to Lahore?" });
    const a = wahaToLiveEvent(projectId, ev(true, "Yes, in 2 days.", 1004));
    expect(a).toMatchObject({ question: "Do you deliver to Lahore?", answer: "Yes, in 2 days.", latency_ms: 4000 });
    expect(q!.conversation_id).not.toContain("923009998877");
  });

  it("ignores groups, statuses and other events", () => {
    expect(wahaToLiveEvent(projectId, ev(false, "hi", 1, "123@g.us"))).toBeNull();
    expect(wahaToLiveEvent(projectId, ev(false, "hi", 1, "status@broadcast"))).toBeNull();
    expect(wahaToLiveEvent(projectId, { event: "session.status" })).toBeNull();
  });

  it("webhook: authenticates by header or ?key=, masks data and grades the reply", async () => {
    const key = get<{ k: string }>("SELECT api_key AS k FROM projects WHERE id = ?", projectId)!.k;
    const post = (body: unknown, auth: "header" | "query" | "none") => wahaWebhook(new Request(
      `https://proofmyai.com/api/v1/whatsapp/waha${auth === "query" ? `?key=${key}` : ""}`,
      { method: "POST", headers: auth === "header" ? { "x-api-key": key, "content-type": "application/json" } : { "content-type": "application/json" }, body: JSON.stringify(body) },
    ));
    expect((await post(ev(false, "hi", 1), "none")).status).toBe(401);
    const now = Math.floor(Date.now() / 1000);
    let r = await post(ev(false, "My email is ali@example.com, where is my order?", now), "header");
    expect(await r.json()).toMatchObject({ kind: "customer_message" });
    expect(get<{ q: string }>("SELECT question AS q FROM wa_last_question")?.q).not.toContain("ali@example.com");
    expect(get("SELECT 1 FROM pending_replies WHERE project_id = ?", projectId)).toBeTruthy();
    r = await post(ev(true, "It ships tomorrow.", now + 3), "query");
    expect(await r.json()).toMatchObject({ kind: "reply", accepted: 1 });
    await new Promise((res) => setTimeout(res, 50));
    const items = all<{ question: string; answer: string; latency_ms: number; conversation_id: string }>("SELECT question, answer, latency_ms, conversation_id FROM audit_items");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ answer: "It ships tomorrow.", latency_ms: 3000 });
    expect(items[0].question).not.toContain("ali@example.com");
    expect(items[0].conversation_id).not.toContain("923009998877");
    expect(get("SELECT 1 FROM pending_replies WHERE project_id = ?", projectId)).toBeUndefined();
    expect((await post({ event: "presence.update" }, "header")).status).toBe(200);
    run("DELETE FROM wa_last_question");
  });
});
