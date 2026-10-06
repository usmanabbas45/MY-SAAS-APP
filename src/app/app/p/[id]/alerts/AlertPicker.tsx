"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/client";

type Field = "target" | "token" | "sid" | "from";
interface Option {
  type: string;
  icon: string;
  name: string;
  hint: string;
  target: { label: string; placeholder: string; inputType?: string };
  extra?: Field[];
  steps: string[];
  severity?: "low" | "medium" | "high";
}

const OPTIONS: Option[] = [
  { type: "email", icon: "✉️", name: "Email", hint: "Instant · no setup", target: { label: "Email address", placeholder: "you@company.com", inputType: "email" },
    steps: ["Type the address that should get alerts. Add more email channels for teammates."] },
  { type: "wa", icon: "🟢", name: "WhatsApp", hint: "Just your number", target: { label: "Your WhatsApp number", placeholder: "+923001234567", inputType: "tel" },
    steps: ["Type your number with + and country code.", "We send a 6-digit code on WhatsApp to confirm it's yours.", "Enter the code and alerts start right away."], severity: "high" },
  { type: "slack", icon: "💬", name: "Slack", hint: "2 minutes", target: { label: "Slack incoming webhook URL", placeholder: "https://hooks.slack.com/services/…", inputType: "url" },
    steps: ["Open api.slack.com/apps → Create New App → From scratch.", "Click Incoming Webhooks → turn it On → Add New Webhook to Workspace.", "Pick the channel, click Allow, and copy the webhook URL here."] },
  { type: "teams", icon: "🟣", name: "Microsoft Teams", hint: "2 minutes", target: { label: "Teams workflow webhook URL", placeholder: "https://…webhook.office.com/…", inputType: "url" },
    steps: ["In the Teams channel click ⋯ → Workflows.", "Choose “Post to a channel when a webhook request is received”.", "Finish the steps and copy the URL here."] },
  { type: "discord", icon: "🎮", name: "Discord", hint: "1 minute", target: { label: "Discord webhook URL", placeholder: "https://discord.com/api/webhooks/…", inputType: "url" },
    steps: ["Server Settings → Integrations → Webhooks → New Webhook.", "Choose the channel and click Copy Webhook URL."] },
  { type: "google_chat", icon: "🟩", name: "Google Chat", hint: "1 minute", target: { label: "Space webhook URL", placeholder: "https://chat.googleapis.com/v1/spaces/…", inputType: "url" },
    steps: ["Open the space → Apps & integrations → Webhooks.", "Add a webhook named ProofMyAI and copy its URL."] },
  { type: "telegram", icon: "✈️", name: "Telegram", hint: "3 minutes", target: { label: "Your chat ID", placeholder: "123456789" }, extra: ["token"],
    steps: ["In Telegram message @BotFather → /newbot, and copy the bot token.", "Send your new bot any message.", "Open https://api.telegram.org/bot<token>/getUpdates and copy the number after \"chat\":{\"id\":"] },
  { type: "sms", icon: "📱", name: "SMS", hint: "Your Twilio account", target: { label: "Your mobile number", placeholder: "+447700900123", inputType: "tel" }, extra: ["sid", "token", "from"], severity: "high",
    steps: ["Uses your own Twilio account (about $0.01–0.08 per message).", "Copy the Account SID and Auth token from console.twilio.com.", "Add the Twilio number to send from."] },
  { type: "whatsapp", icon: "📲", name: "WhatsApp via Twilio", hint: "Your Twilio account", target: { label: "Your WhatsApp number", placeholder: "+447700900123", inputType: "tel" }, extra: ["sid", "token", "from"], severity: "high",
    steps: ["Uses your own Twilio account and a WhatsApp-enabled Twilio number (or the Twilio sandbox after you join it).", "Copy the Account SID and Auth token from console.twilio.com."] },
  { type: "webhook", icon: "🔗", name: "Webhook / Zapier / n8n", hint: "For automations", target: { label: "URL that receives JSON", placeholder: "https://hooks.zapier.com/…", inputType: "url" },
    steps: ["We POST JSON: text, event, severity, module, code, title, detail, project, link.", "Use it to open tickets, page on-call or log to a sheet."] },
];

const MODULE_LABELS: [string, string][] = [["chatbot", "Chatbot answers & missing replies"], ["tests", "Nightly tests"], ["agents", "AI agents"], ["workflows", "n8n & Make"], ["uptime", "Uptime"]];

export function RuleFields({ severity = "medium", modules = "", resolved = false, label = "" }: { severity?: string; modules?: string; resolved?: boolean; label?: string }) {
  const mods = modules.split(",").filter(Boolean);
  return (
    <>
      <div className="grid grid-2">
        <div className="field">
          <label>Send me</label>
          <select name="min_severity" defaultValue={severity}>
            <option value="high">🔴 Only urgent problems (high)</option>
            <option value="medium">🟠 Important problems (medium + high)</option>
            <option value="low">🔵 Everything, including small issues</option>
          </select>
        </div>
        <div className="field">
          <label>Name <span className="hint">(optional, e.g. &ldquo;Support team&rdquo;)</span></label>
          <input name="label" type="text" maxLength={60} defaultValue={label} />
        </div>
      </div>
      <div className="field">
        <label>About</label>
        <div className="alert-mods">
          {MODULE_LABELS.map(([v, l]) => (
            <label key={v} className="check" style={{ margin: 0 }}><input type="checkbox" name="modules" value={v} defaultChecked={mods.length === 0 || mods.includes(v)} /> {l}</label>
          ))}
        </div>
      </div>
      <label className="check"><input type="checkbox" name="notify_resolved" defaultChecked={resolved} /> ✅ Also tell me when a problem is fixed</label>
    </>
  );
}

export function AlertPicker({ action, projectId, managedWhatsApp, ownerEmail }: {
  action: (f: FormData) => Promise<void>; projectId: number; managedWhatsApp: boolean; ownerEmail: string;
}) {
  const options = OPTIONS.filter((o) => o.type !== "wa" || managedWhatsApp);
  const [type, setType] = useState<string | null>(null);
  const o = options.find((x) => x.type === type) ?? null;
  return (
    <div>
      <div className="alert-tiles" role="radiogroup" aria-label="Choose how to get alerts">
        {options.map((x) => (
          <button key={x.type} type="button" role="radio" aria-checked={type === x.type} className={`alert-tile ${type === x.type ? "on" : ""}`} onClick={() => setType(x.type)}>
            <span className="alert-tile-icon" aria-hidden>{x.icon}</span>
            <strong>{x.name}</strong>
            <span className="faint">{x.hint}</span>
          </button>
        ))}
      </div>
      {o ? (
        <form action={action} className="alert-setup" key={o.type}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="type" value={o.type} />
          <h4>{o.icon} Set up {o.name}</h4>
          <ol className="alert-steps">{o.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="al-target">{o.target.label}</label>
              <input id="al-target" name="target" type={o.target.inputType ?? "text"} required placeholder={o.target.placeholder} defaultValue={o.type === "email" ? ownerEmail : ""} autoComplete="off" />
            </div>
            {o.extra?.includes("token") ? <div className="field"><label htmlFor="al-token">{o.type === "telegram" ? "Bot token" : "Twilio Auth token"}</label><input id="al-token" name="token" type="password" required autoComplete="off" placeholder={o.type === "telegram" ? "123456789:AA…" : ""} /></div> : null}
            {o.extra?.includes("sid") ? <div className="field"><label htmlFor="al-sid">Twilio Account SID</label><input id="al-sid" name="sid" type="text" required placeholder="AC…" autoComplete="off" /></div> : null}
            {o.extra?.includes("from") ? <div className="field"><label htmlFor="al-from">Twilio number to send from</label><input id="al-from" name="from" type="text" required placeholder="+14155238886" /></div> : null}
          </div>
          <RuleFields severity={o.severity ?? "medium"} />
          <div className="row" style={{ marginTop: 14 }}>
            <SubmitButton pendingText="Adding…">{o.type === "wa" ? "Send me the code" : `Add ${o.name}`}</SubmitButton>
            <button type="button" className="btn btn-ghost" onClick={() => setType(null)}>Cancel</button>
          </div>
        </form>
      ) : <p className="sub" style={{ marginTop: 12 }}>👆 Pick how you want to hear about problems. You can add as many as you like, each with its own rules.</p>}
    </div>
  );
}
