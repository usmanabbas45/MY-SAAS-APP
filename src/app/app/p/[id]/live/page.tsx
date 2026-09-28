import { AutoRefresh, CopyButton, SubmitButton } from "@/components/client";
import { Badge, Empty, Flash, PageHeader, timeAgo } from "@/components/ui";
import { liveMetrics, unansweredMessages } from "@/lib/audit/live";
import { requireUser } from "@/lib/auth";
import type { ChatSource } from "@/lib/connectors/twilio";
import { all } from "@/lib/db";
import { addChatSourceAction, deleteChatSourceAction, pollChatSourceAction, sendTestEventAction } from "../actions";
import { liveFeed, sourceStatuses, type Source } from "@/lib/live";
import { ownedProject } from "@/lib/projects";
import { liveChatSnippets } from "@/lib/snippets";

export const metadata = { title: "Live" };

const SOURCE_LABEL: Record<Source, { icon: string; name: string; empty: string }> = {
  chatbot: { icon: "💬", name: "Chatbots", empty: "Send conversations to the live endpoint below" },
  agents: { icon: "🤖", name: "AI agents", empty: "Send agent runs (see AI agents page)" },
  workflows: { icon: "⚙️", name: "n8n & Make", empty: "Connect n8n/Make (see n8n & Make page)" },
};

export default async function LivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ only?: string; ok?: string; error?: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const flash = await searchParams;
  const { only } = flash;
  const m = liveMetrics(p.id);
  const unanswered = unansweredMessages(p.id, 5);
  const sources = all<ChatSource>("SELECT * FROM chat_sources WHERE project_id = ? ORDER BY id", p.id);
  const pid = <input type="hidden" name="projectId" value={p.id} />;
  const statuses = sourceStatuses(p.id);
  const feed = liveFeed(p.id, 80).filter((e) => !only || e.source === only || (only === "problems" && !e.ok));
  const snippets = liveChatSnippets(process.env.APP_URL || "http://localhost:3000", p.api_key);
  const base = `/app/p/${p.id}/live`;
  const iso = (ms: number) => new Date(ms).toISOString();

  return (
    <div>
      <AutoRefresh active ms={5000} />
      <Flash ok={flash.ok} error={flash.error} />
      <PageHeader
        title="Live tracking"
        subtitle="Chatbot answers, agent runs and workflow executions, checked the moment they happen"
        actions={
          <>
            <form action={sendTestEventAction}>{pid}<SubmitButton className="btn btn-ghost btn-sm" pendingText="Sending…">▶ Send test event</SubmitButton></form>
            <span className="badge badge-bad"><span className="dot live-dot" /> LIVE · updates every 5s</span>
          </>
        }
      />

      <div className="card">
        <div className="card-head">
          <div><h3>💬 Chatbot health, last 24 hours</h3><span className="sub">Send <code>latency_ms</code>, <code>cost_usd</code> and <code>error</code> with events (or connect Twilio) to fill these in.</span></div>
        </div>
        <div className="grid grid-4">
          <div className="stat"><span className="stat-label">Unanswered customers</span><span className="stat-value" style={{ color: m.unanswered ? "var(--bad)" : undefined }}>{m.unanswered}</span><span className="stat-foot">no reply after {p.reply_timeout_sec ? `${p.reply_timeout_sec}s` : "(alert off)"}</span></div>
          <div className="stat"><span className="stat-label">Avg. response time</span><span className="stat-value">{m.avgLatencyMs == null ? "–" : `${(m.avgLatencyMs / 1000).toFixed(1)}s`}</span><span className="stat-foot">{m.slowReplies} slower than 10s</span></div>
          <div className="stat"><span className="stat-label">Bot errors</span><span className="stat-value" style={{ color: m.errors ? "var(--bad)" : undefined }}>{m.errors}</span><span className="stat-foot">failed or undelivered replies</span></div>
          <div className="stat"><span className="stat-label">Conversation problems</span><span className="stat-value">{m.conversationProblems}</span><span className="stat-foot">{m.fallbacks} fallback{m.fallbacks === 1 ? "" : "s"} · {m.replies ? Math.round((m.fallbacks / m.replies) * 100) : 0}% fallback rate</span></div>
        </div>
        <p className="faint" style={{ margin: "10px 0 0" }}>{m.replies} replies in {m.conversations} conversations{m.costPerConversation != null ? ` · $${m.costPerConversation.toFixed(4)} AI cost per conversation` : ""}.</p>
        {unanswered.length ? (
          <div className="alert alert-bad" style={{ marginTop: 12 }}>
            <strong>Waiting for a reply:</strong>
            <ul style={{ margin: "6px 0 0" }}>
              {unanswered.slice(0, 5).map((u) => <li key={u.conversation_id}><span className="mono">#{u.conversation_id}</span>, {Math.round(u.waiting_sec / 60)} min: “{u.question.slice(0, 100)}”{u.error ? ` (${u.error})` : ""}</li>)}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="grid grid-3">
        {statuses.map((s) => {
          const L = SOURCE_LABEL[s.source];
          return (
            <div key={s.source} className={`card live-status live-${s.state}`}>
              <div className="row between">
                <strong style={{ fontSize: 16 }}>{L.icon} {L.name}</strong>
                {s.state === "ok" ? <Badge tone="ok">🟢 Working</Badge> : s.state === "problem" ? <Badge tone="bad">🔴 Problems</Badge> : <Badge>⚪ No recent data</Badge>}
              </div>
              <div className="stat-value" style={{ marginTop: 8 }}>{s.lastHour}</div>
              <div className="sub">events in the last hour{s.problemsLastHour ? <> · <strong style={{ color: "var(--bad)" }}>{s.problemsLastHour} with problems</strong></> : null}</div>
              <div className="faint" style={{ marginTop: 6 }}>{s.lastAt ? `Last event ${timeAgo(iso(s.lastAt))}` : L.empty}</div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Live feed</h3>
          <div className="tabs" style={{ margin: 0 }}>
            {[["", "All"], ["problems", "Problems only"], ["chatbot", "Chatbots"], ["agents", "Agents"], ["workflows", "Workflows"]].map(([k, label]) => (
              <a key={k} className={`tab ${(only ?? "") === k ? "active" : ""}`} href={k ? `${base}?only=${k}` : base}>{label}</a>
            ))}
          </div>
        </div>
        {feed.length === 0 ? (
          <Empty icon="📡" title="Waiting for live events">Connect a chatbot, agent or workflow. Events appear here within seconds.</Empty>
        ) : (
          <div className="feed">
            {feed.map((e, i) => (
              <div key={i} className="feed-row">
                <span className={`feed-icon ${e.ok ? "ok" : e.warn ? "warn" : "bad"}`}>{e.ok ? "✓" : e.warn ? "!" : "✕"}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div><strong>{e.title}</strong></div>
                  <div className="sub clamp">{e.detail}</div>
                </div>
                <div className="faint" style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  {SOURCE_LABEL[e.source].icon}<br />{timeAgo(iso(e.at))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Connect your chatbot for live tracking</h3>
            <span className="sub">Send each conversation after the bot replies. You can send the full history every time; only new answers are checked. Results land here and in today&apos;s <strong>Live chats</strong> audit (with fix list and feedback).</span>
          </div>
        </div>
        {(["curl", "js", "python"] as const).map((k) => (
          <div key={k} style={{ marginBottom: 12 }}>
            <div className="row between" style={{ marginBottom: 6 }}><strong>{k === "js" ? "JavaScript / TypeScript" : k === "python" ? "Python" : "cURL"}</strong><CopyButton text={snippets[k]} /></div>
            <pre>{snippets[k]}</pre>
          </div>
        ))}
        <p className="sub">
          <strong>Catch messages your bot never answers:</strong> also send each customer message as it arrives, with just <code>{`{"conversation_id": "...", "question": "..."}`}</code>.
          If no reply for that conversation arrives within {p.reply_timeout_sec || 120} seconds, you get an alert. Optional fields: <code>latency_ms</code>, <code>cost_usd</code>, <code>error</code>.
        </p>
        <details>
          <summary>No-code: Intercom, Zendesk, Crisp, Tidio via n8n or Make</summary>
          <ol className="sub">
            <li>In n8n/Make, create a workflow that starts from your chat platform&apos;s <strong>“conversation replied / message created”</strong> trigger (webhook).</li>
            <li>Add an <strong>HTTP Request</strong> step: POST to <code>{snippets.url}</code> with header <code>Authorization: Bearer {p.api_key.slice(0, 12)}…</code>.</li>
            <li>JSON body: <code>{`{"conversation_id": "<conversation id>", "question": "<customer message>", "answer": "<bot reply>"}`}</code></li>
          </ol>
        </details>
      </div>

      <div className="card" id="twilio">
        <div className="card-head">
          <div>
            <h3>📱 Connect WhatsApp or SMS via Twilio (no code)</h3>
            <span className="sub">Read-only: every 15 minutes ProofMyAI reads your Twilio message log, checks the bot&apos;s replies, measures response time, flags failed deliveries and alerts you about customers who got no reply. It never sends messages. Customer numbers are stored only as anonymous IDs.</span>
          </div>
        </div>
        {sources.map((s) => (
          <div key={s.id} className="row between" style={{ padding: "10px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
            <div>
              <strong>{s.name}</strong> <span className="faint mono">{s.bot_address}</span>
              <div className="sub" style={{ margin: 0 }}>{s.last_error ? <span style={{ color: "var(--bad)" }}>⚠ {s.last_error}</span> : s.last_polled_at ? `Checked ${timeAgo(s.last_polled_at)}` : "Not checked yet"}</div>
            </div>
            <div className="row">
              <form action={pollChatSourceAction}>{pid}<input type="hidden" name="sourceId" value={s.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="Checking…">Check now</SubmitButton></form>
              <form action={deleteChatSourceAction}>{pid}<input type="hidden" name="sourceId" value={s.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm="Remove this Twilio connection? Data already imported stays.">Remove</SubmitButton></form>
            </div>
          </div>
        ))}
        <details open={sources.length === 0} style={{ marginTop: 10 }}>
          <summary>+ Connect a Twilio number</summary>
          <form action={addChatSourceAction}>
            {pid}
            <ol className="sub">
              <li>Twilio Console → <strong>Account info</strong>: copy the <strong>Account SID</strong> (starts with AC).</li>
              <li>Recommended: Console → <strong>API keys &amp; tokens</strong> → <strong>Create API key</strong> (Standard) and copy its SID (SK…) and secret. Or use your Auth token.</li>
              <li>Enter the bot&apos;s number exactly as in Twilio, e.g. <code>whatsapp:+14155238886</code> or <code>+447700900123</code>.</li>
            </ol>
            <div className="grid grid-2">
              <div className="field"><label htmlFor="tw-name">Name</label><input id="tw-name" name="name" type="text" placeholder="WhatsApp bot" maxLength={100} /></div>
              <div className="field"><label htmlFor="tw-num">Bot number</label><input id="tw-num" name="bot_number" type="text" placeholder="whatsapp:+14155238886" required /></div>
              <div className="field"><label htmlFor="tw-ac">Account SID</label><input id="tw-ac" name="account_sid" type="text" placeholder="AC…" required autoComplete="off" /></div>
              <div className="field"><label htmlFor="tw-sk">API key SID <span className="hint">(optional, recommended)</span></label><input id="tw-sk" name="key_sid" type="text" placeholder="SK…" autoComplete="off" /></div>
              <div className="field"><label htmlFor="tw-secret">API key secret or Auth token</label><input id="tw-secret" name="secret" type="password" required autoComplete="off" /></div>
            </div>
            <SubmitButton pendingText="Connecting…">Connect Twilio</SubmitButton>
            <p className="hint" style={{ marginTop: 8 }}>Stored encrypted (AES-256-GCM). Masking, results-only mode and retention from Settings → Data &amp; privacy apply to imported messages.</p>
          </form>
        </details>
      </div>
    </div>
  );
}
