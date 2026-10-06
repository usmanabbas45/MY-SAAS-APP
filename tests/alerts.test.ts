import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { all, get, openDatabase, run, setDb } from "@/lib/db";
import { confirmVerificationCode, deliver, managedWhatsAppProvider, notify, sendVerificationCode, validateChannel, wants, type Channel } from "@/lib/notify";
import { createProject } from "@/lib/projects";
import { freshDb } from "./helpers";

const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
const fetcher = (async (url: string, init?: RequestInit) => {
  sent.push({ url, body: String(init?.body ?? ""), headers: (init?.headers ?? {}) as Record<string, string> });
  return new Response("ok", { status: 200 });
}) as never;

const WAHA = { ALERTS_WAHA_URL: "https://waha.example.com/", ALERTS_WAHA_KEY: "k123", ALERTS_WAHA_SESSION: "alerts" };

beforeEach(() => { sent.length = 0; for (const k of Object.keys(WAHA)) delete process.env[k]; });
afterEach(() => { for (const k of Object.keys(WAHA)) delete process.env[k]; });

describe("alert channel choices", () => {
  it("gives every new project an email channel to the owner", () => {
    const { userId } = freshDb();
    const id = createProject(userId, "Shop");
    expect(all("SELECT type, target, min_severity FROM alert_channels WHERE project_id = ?", id)).toEqual([{ type: "email", target: "t@example.com", min_severity: "medium" }]);
  });

  it("moves the old single webhook and email settings into channels once", () => {
    // An existing database from before the upgrade, then a server restart (migrations run again).
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pm-")), "old.db");
    const before = openDatabase(file);
    const u = Number(before.prepare("INSERT INTO users (email, password_hash) VALUES ('a@x.com', 'x')").run().lastInsertRowid);
    before.prepare("INSERT INTO projects (user_id, name, api_key, alert_webhook, alert_email, legacy_email_migrated) VALUES (?, 'P', 'ap_live_1', 'https://hooks.slack.com/services/1', 'boss@x.com', 0)").run(u);
    before.close();
    setDb(openDatabase(file));
    setDb(openDatabase(file)); // a second restart must not duplicate anything
    expect(all("SELECT type, target FROM alert_channels ORDER BY id")).toEqual([
      { type: "slack", target: "https://hooks.slack.com/services/1" },
      { type: "email", target: "boss@x.com" },
    ]);
    expect(get("SELECT alert_webhook, alert_email, legacy_email_migrated FROM projects")).toEqual({ alert_webhook: null, alert_email: "boss@x.com", legacy_email_migrated: 1 });
  });

  it("skips paused and unverified channels", () => {
    const base: Channel = { id: 1, project_id: 1, type: "slack", target: "x", secret_enc: null, min_severity: "low", modules: "", notify_resolved: 0, last_status: null, last_sent_at: null };
    const m = { kind: "problem" as const, module: "chatbot", severity: "high" as const };
    expect(wants(base, m)).toBe(true);
    expect(wants({ ...base, enabled: 0 }, m)).toBe(false);
    expect(wants({ ...base, verify_hash: "abc" }, m)).toBe(false);
  });

  it("offers ProofMyAI WhatsApp only when the server has a sender, and checks the number", async () => {
    expect(managedWhatsAppProvider()).toBeNull();
    await expect(validateChannel("wa", "+923001234567", {})).rejects.toThrow(/not switched on/);
    Object.assign(process.env, WAHA);
    expect(managedWhatsAppProvider()).toBe("waha");
    await expect(validateChannel("wa", "0300 1234567", {})).rejects.toThrow(/international format/);
    expect(await validateChannel("wa", "+92 300 123-4567", {})).toEqual({ type: "wa", target: "+923001234567", secret: null });
  });

  it("verifies the number with a WhatsApp code before sending alerts", async () => {
    Object.assign(process.env, WAHA);
    const { projectId } = freshDb();
    const id = run("INSERT INTO alert_channels (project_id, type, target, min_severity) VALUES (?, 'wa', '+923001234567', 'medium')", projectId).lastInsertRowid;
    await sendVerificationCode(id, fetcher);
    expect(sent[0].url).toBe("https://waha.example.com/api/sendText");
    expect(sent[0].headers["X-Api-Key"]).toBe("k123");
    const body = JSON.parse(sent[0].body) as { session: string; chatId: string; text: string };
    expect(body.session).toBe("alerts");
    expect(body.chatId).toBe("923001234567@c.us");
    const code = body.text.match(/\d{6}/)![0];
    // Pending: no alerts yet.
    expect(await notify({ projectId, kind: "problem", module: "chatbot", code: "X", severity: "high", title: "t", detail: "d" }, fetcher)).toBe(0);
    expect(confirmVerificationCode(id, "000000")).toBe(code === "000000");
    expect(confirmVerificationCode(id, code)).toBe(true);
    expect(get("SELECT verify_hash FROM alert_channels WHERE id = ?", id)).toEqual({ verify_hash: null });
    sent.length = 0;
    expect(await notify({ projectId, kind: "problem", module: "chatbot", code: "X", severity: "high", title: "Bot made up a price", detail: "d" }, fetcher)).toBe(1);
    expect(JSON.parse(sent[0].body).text).toContain("Bot made up a price");
  });

  it("sends through Twilio when that is the configured sender", async () => {
    Object.assign(process.env, { ALERTS_TWILIO_SID: `AC${"a".repeat(32)}`, ALERTS_TWILIO_TOKEN: "t", ALERTS_TWILIO_FROM: "+14155238886" });
    try {
      const ch: Channel = { id: 1, project_id: 1, type: "wa", target: "+447700900123", secret_enc: null, min_severity: "medium", modules: "", notify_resolved: 0, last_status: null, last_sent_at: null };
      await deliver(ch, { projectId: 1, projectName: "Shop", kind: "problem", module: "chatbot", code: "X", severity: "high", title: "t", detail: "d", link: "l" }, fetcher);
      expect(sent[0].url).toContain("api.twilio.com");
      expect(decodeURIComponent(sent[0].body)).toContain("To=whatsapp:+447700900123");
    } finally {
      for (const k of ["ALERTS_TWILIO_SID", "ALERTS_TWILIO_TOKEN", "ALERTS_TWILIO_FROM"]) delete process.env[k];
    }
  });
});

