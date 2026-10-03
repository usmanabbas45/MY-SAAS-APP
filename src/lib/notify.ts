import { all, get, run } from "./db";
import { sendMail } from "./email";
import { alertEmail } from "./emails";
import { assertPublicUrl, decrypt, safeFetch } from "./security";
import { truncate } from "./text";

/**
 * Where and when people are told about problems. Each project can have several channels, each with
 * its own severity threshold, modules and "resolved" notices. Delivery failures never break monitoring.
 */
export const CHANNEL_TYPES = {
  email: { label: "Email", target: "Email address", placeholder: "alerts@company.com" },
  slack: { label: "Slack", target: "Incoming webhook URL", placeholder: "https://hooks.slack.com/services/…" },
  discord: { label: "Discord", target: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…" },
  teams: { label: "Microsoft Teams", target: "Workflow / incoming webhook URL", placeholder: "https://…webhook.office.com/…" },
  google_chat: { label: "Google Chat", target: "Space webhook URL", placeholder: "https://chat.googleapis.com/v1/spaces/…" },
  telegram: { label: "Telegram", target: "Chat ID", placeholder: "123456789 or -100123…" },
  sms: { label: "SMS (Twilio)", target: "Your mobile number", placeholder: "+447700900123" },
  whatsapp: { label: "WhatsApp (Twilio)", target: "Your WhatsApp number", placeholder: "+447700900123" },
  webhook: { label: "Custom webhook (Zapier, n8n, Make)", target: "URL receiving JSON", placeholder: "https://hooks.zapier.com/…" },
} as const;
export type ChannelType = keyof typeof CHANNEL_TYPES;
export const MODULES = ["chatbot", "tests", "agents", "workflows", "uptime"] as const;
export const SEVERITY_RANK = { low: 1, medium: 2, high: 3 } as const;

export interface Channel {
  id: number;
  project_id: number;
  type: ChannelType;
  target: string;
  secret_enc: string | null; // telegram bot token, or Twilio {sid, token, from}
  min_severity: "low" | "medium" | "high";
  modules: string; // comma list, empty = all
  notify_resolved: number;
  last_status: string | null;
  last_sent_at: string | null;
}

export interface AlertMessage {
  projectId: number;
  projectName: string;
  kind: "problem" | "resolved";
  module: string;
  code: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  link: string;
}

export function channelsFor(projectId: number): Channel[] {
  return all<Channel>("SELECT * FROM alert_channels WHERE project_id = ? ORDER BY id", projectId);
}

/** Should this channel receive this message? */
export function wants(ch: Channel, msg: Pick<AlertMessage, "kind" | "module" | "severity">): boolean {
  if (msg.kind === "resolved" && !ch.notify_resolved) return false;
  if (SEVERITY_RANK[msg.severity] < SEVERITY_RANK[ch.min_severity]) return false;
  const mods = ch.modules.split(",").filter(Boolean);
  return mods.length === 0 || mods.includes(msg.module);
}

export function formatText(msg: AlertMessage, max = 3500): string {
  const head = msg.kind === "resolved" ? `✅ RESOLVED: ${msg.title}` : `${msg.severity === "high" ? "🔴" : msg.severity === "medium" ? "🟠" : "🔵"} ${msg.severity.toUpperCase()}: ${msg.title}`;
  return truncate(`[ProofMyAI · ${msg.projectName}] ${head}\n${msg.detail}\n${msg.link}`, max);
}

type Fetcher = typeof safeFetch;

/** Sends one message to one channel. Throws on failure (callers record the status). */
export async function deliver(ch: Channel, msg: AlertMessage, fetcher: Fetcher = safeFetch): Promise<void> {
  const text = formatText(msg);
  const json = (url: string, body: unknown) => fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 10000);
  let res: Response | null = null;
  switch (ch.type) {
    case "email":
      if (!(await sendMail(ch.target, alertEmail(msg, ch.target), { fromName: "ProofMyAI Alerts" }))) throw new Error("Email is not set up on the server (RESEND_API_KEY).");
      return;
    case "slack":
    case "teams":
    case "google_chat":
      res = await json(ch.target, { text });
      break;
    case "discord":
      res = await json(ch.target, { content: truncate(text, 1900) });
      break;
    case "webhook":
      res = await json(ch.target, { text, event: msg.kind, severity: msg.severity, module: msg.module, code: msg.code, title: msg.title, detail: msg.detail, project: msg.projectName, link: msg.link });
      break;
    case "telegram": {
      const token = decrypt(ch.secret_enc ?? "");
      res = await json(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: ch.target, text, disable_web_page_preview: true });
      break;
    }
    case "sms":
    case "whatsapp": {
      const c = JSON.parse(decrypt(ch.secret_enc ?? "")) as { sid: string; token: string; from: string };
      const wa = ch.type === "whatsapp" ? "whatsapp:" : "";
      const from = c.from.startsWith("whatsapp:") || !wa ? c.from : `${wa}${c.from}`;
      res = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.sid)}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: from, To: `${wa}${ch.target}`, Body: truncate(text, ch.type === "sms" ? 600 : 1500) }).toString(),
      }, 10000);
      break;
    }
  }
  if (res && !res.ok) throw new Error(`${CHANNEL_TYPES[ch.type].label} answered HTTP ${res.status}: ${truncate(await res.text().catch(() => ""), 160)}`);
}

/** Sends a message to every matching channel of the project (plus the legacy webhook/email fields). */
export async function notify(msg: Omit<AlertMessage, "projectName" | "link">, fetcher: Fetcher = safeFetch): Promise<number> {
  const project = get<{ name: string; alert_webhook: string | null; alert_email: string | null }>(
    "SELECT name, alert_webhook, alert_email FROM projects WHERE id = ?", msg.projectId,
  );
  if (!project) return 0;
  const full: AlertMessage = { ...msg, projectName: project.name, link: `${process.env.APP_URL ?? ""}/app/p/${msg.projectId}/incidents` };
  const channels = channelsFor(msg.projectId).filter((c) => wants(c, full));
  // Legacy single webhook / email from the original settings: medium+ problems, all modules.
  const legacy: Channel[] = [];
  const base = { id: 0, project_id: msg.projectId, secret_enc: null, min_severity: "medium" as const, modules: "", notify_resolved: 0, last_status: null, last_sent_at: null };
  if (project.alert_webhook) legacy.push({ ...base, type: /discord\.com/.test(project.alert_webhook) ? "discord" : "webhook", target: project.alert_webhook });
  if (project.alert_email) legacy.push({ ...base, type: "email", target: project.alert_email });
  const targets = [...channels, ...legacy.filter((c) => wants(c, full))];
  const results = await Promise.allSettled(targets.map((c) => deliver(c, full, fetcher)));
  results.forEach((r, i) => {
    const ch = targets[i];
    const status = r.status === "fulfilled" ? "ok" : truncate(String(r.reason instanceof Error ? r.reason.message : r.reason), 200);
    if (r.status === "rejected") console.error(`[alerts] ${ch.type} delivery failed:`, status);
    if (ch.id) run("UPDATE alert_channels SET last_status = ?, last_sent_at = ? WHERE id = ?", status, new Date().toISOString(), ch.id);
  });
  return results.filter((r) => r.status === "fulfilled").length;
}

/** Validates and normalises a new channel from the settings form. Throws a readable error. */
export async function validateChannel(type: string, target: string, secret: { token?: string; sid?: string; from?: string }): Promise<{ type: ChannelType; target: string; secret: string | null }> {
  if (!(type in CHANNEL_TYPES)) throw new Error("Choose a channel type.");
  const t = type as ChannelType;
  const v = target.trim();
  if (t === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error("Enter a valid email address.");
    return { type: t, target: v, secret: null };
  }
  if (["slack", "discord", "teams", "google_chat", "webhook"].includes(t)) {
    if (!/^https:\/\//.test(v)) throw new Error("The webhook URL must start with https://");
    await assertPublicUrl(v);
    return { type: t, target: v, secret: null };
  }
  if (t === "telegram") {
    if (!/^-?\d{3,20}$/.test(v)) throw new Error("The Telegram chat ID is a number (message your bot, then open https://api.telegram.org/bot<token>/getUpdates to see it).");
    if (!/^\d{5,12}:[\w-]{30,}$/.test(secret.token ?? "")) throw new Error("Paste the bot token from @BotFather (looks like 123456789:AA…).");
    return { type: t, target: v, secret: secret.token! };
  }
  // sms / whatsapp via the customer's own Twilio account
  const phone = v.replace(/[\s-]/g, "");
  if (!/^\+\d{7,15}$/.test(phone)) throw new Error("Enter the number in international format, e.g. +447700900123.");
  if (!/^AC[0-9a-f]{32}$/i.test(secret.sid ?? "")) throw new Error("Enter your Twilio Account SID (starts with AC).");
  if (!secret.token) throw new Error("Enter your Twilio Auth token.");
  const from = (secret.from ?? "").replace(/\s/g, "");
  if (!/^(whatsapp:)?\+\d{7,15}$/.test(from)) throw new Error("Enter the Twilio number to send from, e.g. +14155238886.");
  return { type: t, target: phone, secret: JSON.stringify({ sid: secret.sid, token: secret.token, from }) };
}
