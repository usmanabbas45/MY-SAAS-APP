import { beforeEach, describe, expect, it } from "vitest";
import { alertMissingReplies, LiveChatSchema, processLiveChat } from "@/lib/audit/live";
import { all, get, run } from "@/lib/db";
import { raiseIncident, resolveIncidents } from "@/lib/incidents";
import { deliver, formatText, notify, validateChannel, wants, type Channel } from "@/lib/notify";
import { encrypt } from "@/lib/security";
import { freshDb } from "./helpers";

let projectId: number;
const sent: { url: string; body: string; auth?: string }[] = [];
const fetcher = (async (url: string, init?: RequestInit) => {
  sent.push({ url, body: String(init?.body ?? ""), auth: (init?.headers as Record<string, string>)?.Authorization });
  return new Response("ok", { status: url.includes("fail") ? 500 : 200 });
}) as never;
const channel = (over: Partial<Channel>): Channel => ({
  id: 0, project_id: projectId, type: "slack", target: "https://hooks.slack.com/x", secret_enc: null, min_severity: "medium", modules: "",
  notify_resolved: 0, last_status: null, last_sent_at: null, ...over,
});
const msg = { projectId: 0, projectName: "Shop", kind: "problem" as const, module: "chatbot", code: "X", severity: "high" as const, title: "Bot made up a price", detail: "d", link: "https://x/app" };

beforeEach(() => {
  sent.length = 0;
  ({ projectId } = freshDb());
});

describe("notification rules", () => {
  it("filters by severity, module and resolved notices", () => {
    expect(wants(channel({ min_severity: "high" }), { kind: "problem", module: "chatbot", severity: "medium" })).toBe(false);
    expect(wants(channel({ min_severity: "low" }), { kind: "problem", module: "agents", severity: "low" })).toBe(true);
    expect(wants(channel({ modules: "workflows" }), { kind: "problem", module: "chatbot", severity: "high" })).toBe(false);
    expect(wants(channel({}), { kind: "resolved", module: "chatbot", severity: "high" })).toBe(false);
    expect(wants(channel({ notify_resolved: 1 }), { kind: "resolved", module: "chatbot", severity: "high" })).toBe(true);
  });

  it("formats each channel correctly", async () => {
    expect(formatText(msg)).toMatch(/^\[ProofMyAI · Shop\] 🔴 HIGH: Bot made up a price/);
    expect(formatText({ ...msg, kind: "resolved" })).toContain("✅ RESOLVED");
    await deliver(channel({ type: "discord", target: "https://discord.com/api/webhooks/1" }), msg, fetcher);
    expect(JSON.parse(sent[0].body)).toHaveProperty("content");
    await deliver(channel({ type: "telegram", target: "12345", secret_enc: encrypt("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef") }), msg, fetcher);
    expect(sent[1].url).toBe("https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/sendMessage");
    expect(JSON.parse(sent[1].body)).toMatchObject({ chat_id: "12345" });
    await deliver(channel({ type: "whatsapp", target: "+447700900123", secret_enc: encrypt(JSON.stringify({ sid: `AC${"b".repeat(32)}`, token: "t", from: "+14155238886" })) }), msg, fetcher);
    const body = new URLSearchParams(sent[2].body);
    expect(sent[2].url).toContain("/Messages.json");
    expect([body.get("From"), body.get("To")]).toEqual(["whatsapp:+14155238886", "whatsapp:+447700900123"]);
    expect(sent[2].auth).toMatch(/^Basic /);
    await deliver(channel({ type: "webhook", target: "https://hooks.zapier.com/1" }), msg, fetcher);
    expect(JSON.parse(sent[3].body)).toMatchObject({ event: "problem", severity: "high", module: "chatbot", project: "Shop" });
    await expect(deliver(channel({ target: "https://fail.example/x" }), msg, fetcher)).rejects.toThrow(/HTTP 500/);
  });

  it("validates new channels", async () => {
    await expect(validateChannel("email", "nope", {})).rejects.toThrow(/valid email/);
    await expect(validateChannel("slack", "http://x", {})).rejects.toThrow(/https/);
    await expect(validateChannel("telegram", "123", { token: "bad" })).rejects.toThrow(/BotFather/);
    await expect(validateChannel("sms", "+44 7700 900123", { sid: `AC${"a".repeat(32)}`, token: "t", from: "+1415" })).rejects.toThrow(/send from/);
    expect(await validateChannel("sms", "+44 7700 900123", { sid: `AC${"a".repeat(32)}`, token: "t", from: "+14155238886" })).toMatchObject({ type: "sms", target: "+447700900123" });
  });

  it("notifies matching channels, records delivery status and sends resolved notices", async () => {
    run("INSERT INTO alert_channels (project_id, type, target, min_severity, notify_resolved) VALUES (?, 'slack', 'https://hooks.slack.com/a', 'high', 1)", projectId);
    run("INSERT INTO alert_channels (project_id, type, target, min_severity, modules) VALUES (?, 'discord', 'https://fail.discord/x', 'medium', 'workflows')", projectId);
    expect(await notify({ projectId, kind: "problem", module: "chatbot", code: "X", severity: "high", title: "t", detail: "d" }, fetcher)).toBe(1);
    expect(all("SELECT type, last_status FROM alert_channels ORDER BY id")).toEqual([{ type: "slack", last_status: "ok" }, { type: "discord", last_status: null }]);
    await notify({ projectId, kind: "problem", module: "workflows", code: "X", severity: "medium", title: "t", detail: "d" }, fetcher);
    expect(get<{ last_status: string }>("SELECT last_status FROM alert_channels WHERE type = 'discord'")!.last_status).toMatch(/HTTP 500/);
  });
});

describe("missing-reply alerts close themselves", () => {
  it("resolves the no-reply incident once the customer is answered, so the next miss alerts again", async () => {
    const p = get<{ id: number; redact_pii: number; mask_terms: string | null }>("SELECT id, redact_pii, mask_terms FROM projects WHERE id = ?", projectId)!;
    const old = new Date(Date.now() - 600000).toISOString();
    await processLiveChat(p, LiveChatSchema.parse({ conversation_id: "a", question: "hello?" }), { receivedAt: old });
    await alertMissingReplies(projectId);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM incidents WHERE resolved = 0")!.n).toBe(1);
    await (await processLiveChat(p, LiveChatSchema.parse({ conversation_id: "a", question: "hello?", answer: "Hi, sorry!" }), { wait: true })).grades;
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM incidents WHERE resolved = 0")!.n).toBe(0);
    await processLiveChat(p, LiveChatSchema.parse({ conversation_id: "b", question: "anyone?" }), { receivedAt: old });
    await alertMissingReplies(projectId);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM incidents WHERE resolved = 0")!.n).toBe(1);
  });

  it("raise and resolve still work without channels", async () => {
    expect(await raiseIncident(projectId, { module: "workflows", code: "F", severity: "high", title: "t", detail: "d", dedupeKey: "k" })).toBe(true);
    expect(await raiseIncident(projectId, { module: "workflows", code: "F", severity: "high", title: "t", detail: "d", dedupeKey: "k" })).toBe(false);
    resolveIncidents(projectId, "k");
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM incidents WHERE resolved = 1")!.n).toBe(1);
  });
});
