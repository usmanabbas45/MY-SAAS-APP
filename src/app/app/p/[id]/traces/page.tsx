import Link from "next/link";
import { Badge, Empty, Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { projectAccess } from "@/lib/projects";
import { recentTraces, traceTimeline, type TraceSource } from "@/lib/traces";

export const metadata = { title: "Traces" };

const ICON: Record<TraceSource, string> = { chatbot: "💬", agents: "🤖", workflows: "⚙️", approvals: "✋", verify: "🔎" };
const NAME: Record<TraceSource, string> = { chatbot: "Chatbot", agents: "AI agent", workflows: "Workflow", approvals: "Approval", verify: "Result check" };

export default async function TracesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string; ok?: string; error?: string }> }) {
  const user = await requireUser();
  const p = projectAccess(user.id, Number((await params).id)).project;
  const sp = await searchParams;
  const t = (sp.t ?? "").trim().slice(0, 200);
  const events = t ? traceTimeline(p.id, t) : [];
  const firstBad = events.findIndex((e) => !e.ok);
  const recent = recentTraces(p.id);
  const base = `/app/p/${p.id}/traces`;

  return (
    <div>
      <Flash ok={sp.ok} error={sp.error} />
      {t.startsWith("simulation-") ? <p className="sub">Open <Link href={`/app/p/${p.id}/incidents`}>Incidents</Link> to see the [Test] incident it raised. You can resolve it there.</p> : null}
      <PageHeader title="Traces" subtitle="Follow one request end to end: chatbot reply → agent → workflow → approval → result check, on one timeline" />
      <div className="card">
        <form className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input name="t" defaultValue={t} placeholder="Trace id, e.g. order-4471 or a chat id" aria-label="Trace id" style={{ flex: "1 1 260px" }} />
          <button className="btn">Show timeline</button>
        </form>
        <p className="sub" style={{ marginTop: 8 }}>Send the same <code>trace_id</code> with <code>/chat-events</code>, <code>/check</code>, <code>/agent-runs</code>, <code>/workflow-runs</code>, <code>/approvals</code> and <code>/verify</code> (OpenTelemetry traces use their trace id). <a href="/docs#chat-events" target="_blank" rel="noopener">How ↗</a></p>
      </div>

      {t ? (
        <div className="card">
          <div className="card-head"><div><h3>🔗 {t}</h3><span className="sub">{events.length} step{events.length === 1 ? "" : "s"}{firstBad >= 0 ? ` · first problem at step ${firstBad + 1}` : events.length ? " · no problems" : ""}</span></div></div>
          {events.length ? (
            <ol className="trace-timeline">
              {events.map((e, i) => (
                <li key={i} className={e.ok ? "" : "bad"}>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span>{ICON[e.source]} <strong>{NAME[e.source]}</strong></span>
                    {e.ok && e.title.startsWith("Waiting for approval") ? <Badge tone="warn">Waiting for a person</Badge> : <Badge tone={e.ok ? "ok" : "bad"}>{e.ok ? "OK" : i === firstBad ? "First problem" : "Problem"}</Badge>}
                    <span className="sub">{new Date(e.at).toISOString().replace("T", " ").slice(0, 19)} UTC</span>
                  </div>
                  <div>{e.title}</div>
                  {e.detail ? <div className="sub">{e.detail}</div> : null}
                </li>
              ))}
            </ol>
          ) : <Empty icon="🔗" title="No steps with this trace id">Check the id, or send it with your next request.</Empty>}
        </div>
      ) : null}

      <div className="card">
        <h3>Recent traces</h3>
        {recent.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Trace id</th><th>Steps</th><th>Problems</th><th>Last step</th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.traceId}>
                    <td><Link href={`${base}?t=${encodeURIComponent(r.traceId)}`}><code>{r.traceId}</code></Link></td>
                    <td>{r.steps}</td>
                    <td>{r.failed ? <Badge tone="bad">{r.failed}</Badge> : <Badge tone="ok">0</Badge>}</td>
                    <td>{timeAgo(r.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="sub">No traces yet. Add a <code>trace_id</code> to your API calls to see them here.</p>}
      </div>
    </div>
  );
}
