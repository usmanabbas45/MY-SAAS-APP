import { CopyButton, SubmitButton } from "@/components/client";
import { Badge, Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { FEATURE_NAMES } from "@/lib/judge/features";
import { judgeLabel } from "@/lib/judge/llm";
import { MIN_TRAINING_LABELS } from "@/lib/ml/risk";
import { ownedProject } from "@/lib/projects";
import { CHANNEL_TYPES, channelsFor } from "@/lib/notify";
import { addChannelAction, deleteChannelAction, deleteProjectAction, regenerateKeyAction, retrainAction, testAlertAction, updatePrivacyAction, updateSettingsAction } from "../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const flash = await searchParams;
  const model = get<{ n_samples: number; val_accuracy: number; trained_at: string }>("SELECT n_samples, val_accuracy, trained_at FROM risk_models WHERE project_id = ?", p.id);
  const labels = get<{ n: number; bad: number | null }>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN COALESCE(i.corrected_verdict, i.verdict) <> 'correct' THEN 1 ELSE 0 END) AS bad
       FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND i.feedback IS NOT NULL`, p.id,
  );
  const pid = <input type="hidden" name="projectId" value={p.id} />;
  const channels = channelsFor(p.id);

  return (
    <div>
      <Flash {...flash} />
      <PageHeader title="Settings" subtitle={`Project: ${p.name}`} />
      <div className="grid grid-2">
        <form action={updateSettingsAction} className="card">
          {pid}
          <h3>Project & alerts</h3>
          <div className="field"><label htmlFor="name">Project name</label><input id="name" name="name" type="text" defaultValue={p.name} maxLength={100} /></div>
          <div className="field">
            <label htmlFor="wh">Alert webhook <span className="hint">(Slack, Discord, Teams or Google Chat incoming-webhook URL)</span></label>
            <input id="wh" name="alert_webhook" type="url" defaultValue={p.alert_webhook ?? ""} placeholder="https://hooks.slack.com/services/…" />
          </div>
          <div className="field">
            <label htmlFor="em">Alert email {process.env.RESEND_API_KEY ? null : <span className="hint">(needs RESEND_API_KEY on the server)</span>}</label>
            <input id="em" name="alert_email" type="email" defaultValue={p.alert_email ?? ""} placeholder="you@company.com" />
          </div>
          <div className="field">
            <label htmlFor="rt">Alert when the chatbot hasn&apos;t replied within <span className="hint">(seconds; 0 = off. Checked every minute for live tracking, every 15 minutes for Twilio)</span></label>
            <input id="rt" name="reply_timeout_sec" type="number" min="0" max="86400" defaultValue={p.reply_timeout_sec} />
          </div>
          <h3 style={{ marginTop: 18 }}>AI agent limits</h3>
          <div className="grid grid-3">
            <div className="field"><label htmlFor="b">Budget / run ($)</label><input id="b" name="agent_cost_budget_usd" type="number" step="any" min="0.0001" defaultValue={p.agent_cost_budget_usd} /></div>
            <div className="field"><label htmlFor="s">Max steps</label><input id="s" name="agent_max_steps" type="number" min="1" defaultValue={p.agent_max_steps} /></div>
            <div className="field"><label htmlFor="t">Max seconds</label><input id="t" name="agent_max_seconds" type="number" min="1" defaultValue={Math.round(p.agent_max_ms / 1000)} /></div>
          </div>
          <label className="check"><input type="checkbox" name="agent_ai_review" defaultChecked={Boolean(p.agent_ai_review)} /> AI review of agent outputs (goal achieved? grounded in tool results?)</label>
          <h3 style={{ marginTop: 18 }}>Reports</h3>
          <label className="check"><input type="checkbox" name="weekly_digest" defaultChecked={Boolean(p.weekly_digest)} /> 📬 Send a weekly summary email to the alert email</label>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="brand">Report brand name <span className="hint">(agencies: your agency name on shared client reports; empty = ProofMyAI)</span></label>
            <input id="brand" name="report_brand" type="text" defaultValue={p.report_brand ?? ""} maxLength={80} placeholder="Your Agency Ltd" />
          </div>
          <div className="row" style={{ marginTop: 16 }}><SubmitButton pendingText="Saving…">Save settings</SubmitButton></div>
        </form>

        <div className="stack">
          <div className="card">
            <h3>Test your alerts</h3>
            <p className="sub">Sends a sample incident to your webhook and email.</p>
            <form action={testAlertAction}>{pid}<SubmitButton className="btn btn-ghost" pendingText="Sending…">Send test alert</SubmitButton></form>
          </div>
          <div className="card">
            <h3>API key</h3>
            <p className="sub">Used by your agents, n8n and Make to send runs. Keep it secret.</p>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <code style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.api_key.slice(0, 14)}••••••••••••</code>
              <CopyButton text={p.api_key} />
            </div>
            <form action={regenerateKeyAction} style={{ marginTop: 12 }}>{pid}<SubmitButton className="btn btn-ghost btn-sm" confirm="The current key will stop working immediately. Continue?">Regenerate key</SubmitButton></form>
          </div>
        </div>
      </div>

      <div className="card" id="notifications">
        <div className="card-head">
          <div>
            <h3>🔔 Notifications: where and when you hear about problems</h3>
            <span className="sub">Add as many channels as you like. Each one has its own rules: how serious a problem must be, which parts of ProofMyAI, and whether to also tell you when it&apos;s fixed. Repeated problems are grouped into one alert.</span>
          </div>
        </div>
        {channels.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Channel</th><th>Sends to</th><th>When</th><th>Last delivery</th><th /></tr></thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{CHANNEL_TYPES[c.type]?.label ?? c.type}</strong></td>
                    <td className="mono" style={{ wordBreak: "break-all" }}>{c.type === "email" || c.type === "telegram" ? c.target : c.type === "sms" || c.type === "whatsapp" ? `${c.target.slice(0, 4)}•••${c.target.slice(-3)}` : `${c.target.slice(0, 32)}…`}</td>
                    <td>{c.min_severity === "high" ? "High only" : c.min_severity === "medium" ? "Medium + high" : "Everything"} · {c.modules ? c.modules.split(",").join(", ") : "all modules"}{c.notify_resolved ? " · + resolved" : ""}</td>
                    <td>{c.last_status ? (c.last_status === "ok" ? <Badge tone="ok">✓ {timeAgo(c.last_sent_at!)}</Badge> : <span style={{ color: "var(--bad)" }} title={c.last_status}>⚠ {c.last_status.slice(0, 60)}</span>) : <span className="faint">not used yet</span>}</td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <form action={testAlertAction}>{pid}<input type="hidden" name="channelId" value={c.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Test</SubmitButton></form>
                        <form action={deleteChannelAction}>{pid}<input type="hidden" name="channelId" value={c.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm="Remove this notification channel?">Remove</SubmitButton></form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="sub">No channels yet{p.alert_webhook || p.alert_email ? " (the webhook/email above still receive medium and high alerts)" : ""}. Add one below.</p>}
        <details open={channels.length === 0} style={{ marginTop: 12 }}>
          <summary>+ Add a notification channel</summary>
          <form action={addChannelAction}>
            {pid}
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="ch-type">Channel</label>
                <select id="ch-type" name="type" defaultValue="email">
                  {(Object.keys(CHANNEL_TYPES) as (keyof typeof CHANNEL_TYPES)[]).map((k) => <option key={k} value={k}>{CHANNEL_TYPES[k].label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ch-target">Send to <span className="hint">(email, webhook URL, Telegram chat ID or phone number)</span></label>
                <input id="ch-target" name="target" type="text" required placeholder="alerts@company.com · https://hooks.slack.com/… · +447700900123" />
              </div>
              <div className="field">
                <label htmlFor="ch-sev">Send me</label>
                <select id="ch-sev" name="min_severity" defaultValue="medium">
                  <option value="high">Only high-risk problems (e.g. SMS at night)</option>
                  <option value="medium">Medium and high problems</option>
                  <option value="low">Everything, including low</option>
                </select>
              </div>
              <div className="field">
                <div className="stat-label" style={{ marginBottom: 6 }}>About</div>
                <div className="row">
                  {[["chatbot", "Chatbot answers & missing replies"], ["tests", "Nightly tests"], ["agents", "AI agents"], ["workflows", "n8n & Make"]].map(([v, l]) => (
                    <label key={v} className="check" style={{ margin: 0 }}><input type="checkbox" name="modules" value={v} defaultChecked /> {l}</label>
                  ))}
                </div>
              </div>
            </div>
            <label className="check"><input type="checkbox" name="notify_resolved" /> Also tell me when a problem is resolved</label>
            <details style={{ marginTop: 10 }}>
              <summary>Telegram, SMS or WhatsApp: extra details</summary>
              <ul className="sub">
                <li><strong>Telegram:</strong> create a bot with <strong>@BotFather</strong> and paste its token below. Send your bot a message, then open <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> to find your chat ID (put it in &quot;Send to&quot;).</li>
                <li><strong>SMS / WhatsApp:</strong> uses your own Twilio account (about $0.01–0.08 per message). Put your mobile number in &quot;Send to&quot;. For WhatsApp, the sender must be a WhatsApp-enabled Twilio number (or the Twilio sandbox, after you join it).</li>
              </ul>
              <div className="grid grid-3">
                <div className="field"><label htmlFor="ch-token">Telegram bot token / Twilio auth token</label><input id="ch-token" name="token" type="password" autoComplete="off" /></div>
                <div className="field"><label htmlFor="ch-sid">Twilio Account SID</label><input id="ch-sid" name="sid" type="text" placeholder="AC…" autoComplete="off" /></div>
                <div className="field"><label htmlFor="ch-from">Twilio number to send from</label><input id="ch-from" name="from" type="text" placeholder="+14155238886" /></div>
              </div>
            </details>
            <div style={{ marginTop: 12 }}><SubmitButton pendingText="Adding…">Add channel</SubmitButton></div>
          </form>
        </details>
        {channels.length ? <form action={testAlertAction} style={{ marginTop: 12 }}>{pid}<SubmitButton className="btn btn-ghost" pendingText="Sending…">Test all channels</SubmitButton></form> : null}
      </div>

      <form action={updatePrivacyAction} className="card" id="privacy">
        {pid}
        <div className="card-head">
          <div><h3>🔒 Data & privacy</h3><span className="sub">Control what ProofMyAI masks, stores and sends to an AI provider for this project. See the <a href="/security" target="_blank">Trust Center</a> and <a href="/dpa" target="_blank">DPA</a>.</span></div>
        </div>
        <div className="grid grid-2">
          <div>
            <label className="check"><input type="checkbox" name="redact_pii" defaultChecked={Boolean(p.redact_pii)} /> Mask personal data before storing or AI checking: emails, phone numbers, card numbers, IBANs, IPs, UK postcodes, UK number plates and self-introduced names (&quot;my name is …&quot;)</label>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="mask_terms">Extra words to mask <span className="hint">(one per line: customer names, account numbers, internal codes. Replaced with [masked])</span></label>
              <textarea id="mask_terms" name="mask_terms" rows={4} defaultValue={p.mask_terms ?? ""} placeholder={"Anna Smith\nAB Dealers\nPolicy WF-"} />
            </div>
          </div>
          <div>
            <div className="field">
              <label htmlFor="retention_days">Keep chats, agent runs and test answers for</label>
              <select id="retention_days" name="retention_days" defaultValue={String(p.retention_days)}>
                <option value="0">Until I delete them</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
              <span className="hint">Older data is deleted automatically every 15 minutes (with the scheduled checks).</span>
            </div>
            <label className="check" style={{ marginTop: 8 }}><input type="checkbox" name="store_text" defaultChecked={Boolean(p.store_text)} /> Store conversation text. Turn off to keep only results (verdict, reason, scores), never the customer&apos;s words or the bot&apos;s reply.</label>
            <label className="check" style={{ marginTop: 8 }}><input type="checkbox" name="use_ai" defaultChecked={Boolean(p.use_ai)} /> Use the AI judge ({judgeLabel()}). Turn off to keep all data inside ProofMyAI: checks then use rules and your neural model only.</label>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}><SubmitButton pendingText="Saving…">Save privacy settings</SubmitButton></div>
      </form>

      <div className="card">
        <div className="card-head">
          <div><h3>🧠 Your neural risk model</h3><span className="sub">A deep neural network (2 hidden layers, Adam optimiser, early stopping) trained only on this project&apos;s reviewed answers. It learns which answers <em>your</em> business considers wrong and ranks them first.</span></div>
          <Badge tone={model ? "ok" : "muted"}>{model ? "Trained" : "Not trained yet"}</Badge>
        </div>
        <div className="grid grid-4">
          <div className="stat"><span className="stat-label">Reviewed answers</span><span className="stat-value">{labels?.n ?? 0}</span><span className="stat-foot">{MIN_TRAINING_LABELS} needed to train</span></div>
          <div className="stat"><span className="stat-label">Marked as bad</span><span className="stat-value">{labels?.bad ?? 0}</span><span className="stat-foot">needs good and bad examples</span></div>
          <div className="stat"><span className="stat-label">Validation accuracy</span><span className="stat-value">{model ? `${Math.round(model.val_accuracy * 100)}%` : "–"}</span><span className="stat-foot">on held-out reviews</span></div>
          <div className="stat"><span className="stat-label">Last trained</span><span className="stat-value" style={{ fontSize: 20 }}>{model ? timeAgo(model.trained_at) : "never"}</span><span className="stat-foot">{model ? `${model.n_samples} samples` : ""}</span></div>
        </div>
        <div className="progress" style={{ margin: "14px 0" }}><span style={{ width: `${Math.min(100, ((labels?.n ?? 0) / MIN_TRAINING_LABELS) * 100)}%` }} /></div>
        <div className="row">
          <form action={retrainAction}>{pid}<SubmitButton pendingText="Training…">{model ? "Retrain model" : "Train model"}</SubmitButton></form>
          <a className="btn btn-ghost" href={`/app/p/${p.id}/export`}>⬇ Export training data (JSONL)</a>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Inputs: {FEATURE_NAMES.length} signals ({FEATURE_NAMES.slice(0, 5).join(", ")}, …). The export is ready for fine-tuning a larger model once you have thousands of reviews.
          Active judge: <strong>{judgeLabel()}</strong>.
        </p>
      </div>

      <form action={deleteProjectAction} className="card" style={{ borderColor: "var(--bad)" }}>
        {pid}
        <h3 style={{ color: "var(--bad)" }}>Delete project</h3>
        <p className="sub">Deletes all audits, tests, runs and incidents for this project. This cannot be undone.</p>
        <div className="row">
          <input name="confirm" type="text" placeholder={`Type "${p.name}" to confirm`} style={{ maxWidth: 320 }} />
          <SubmitButton className="btn btn-danger" pendingText="Deleting…">Delete project</SubmitButton>
        </div>
      </form>
    </div>
  );
}
