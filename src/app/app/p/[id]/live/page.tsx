import { AutoRefresh, CopyButton } from "@/components/client";
import { Badge, Empty, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { liveFeed, sourceStatuses, type Source } from "@/lib/live";
import { ownedProject } from "@/lib/projects";
import { liveChatSnippets } from "@/lib/snippets";

export const metadata = { title: "Live" };

const SOURCE_LABEL: Record<Source, { icon: string; name: string; empty: string }> = {
  chatbot: { icon: "💬", name: "Chatbots", empty: "Send conversations to the live endpoint below" },
  agents: { icon: "🤖", name: "AI agents", empty: "Send agent runs (see AI agents page)" },
  workflows: { icon: "⚙️", name: "n8n & Make", empty: "Connect n8n/Make (see n8n & Make page)" },
};

export default async function LivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ only?: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const { only } = await searchParams;
  const statuses = sourceStatuses(p.id);
  const feed = liveFeed(p.id, 80).filter((e) => !only || e.source === only || (only === "problems" && !e.ok));
  const snippets = liveChatSnippets(process.env.APP_URL || "http://localhost:3000", p.api_key);
  const base = `/app/p/${p.id}/live`;
  const iso = (ms: number) => new Date(ms).toISOString();

  return (
    <div>
      <AutoRefresh active ms={5000} />
      <PageHeader
        title="Live tracking"
        subtitle="Every chatbot answer, agent run and workflow execution, checked the moment it happens"
        actions={<span className="badge badge-bad"><span className="dot live-dot" /> LIVE · updates every 5s</span>}
      />

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
        <details>
          <summary>No-code: Intercom, Zendesk, Crisp, Tidio via n8n or Make</summary>
          <ol className="sub">
            <li>In n8n/Make, create a workflow that starts from your chat platform&apos;s <strong>“conversation replied / message created”</strong> trigger (webhook).</li>
            <li>Add an <strong>HTTP Request</strong> step: POST to <code>{snippets.url}</code> with header <code>Authorization: Bearer {p.api_key.slice(0, 12)}…</code>.</li>
            <li>JSON body: <code>{`{"conversation_id": "<conversation id>", "question": "<customer message>", "answer": "<bot reply>"}`}</code></li>
          </ol>
        </details>
      </div>
    </div>
  );
}
