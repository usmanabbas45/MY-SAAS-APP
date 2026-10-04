import Link from "next/link";
import { CopyButton } from "@/components/client";
import { AccuracyChart, ConversationsChart } from "@/components/analytics-charts";
import { Empty, PageHeader } from "@/components/ui";
import { chatAnalytics, RANGES, type Kpis } from "@/lib/analytics-chat";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { projectAccess } from "@/lib/projects";

export const metadata = { title: "Chatbot analytics" };

/** Change vs the previous period, as a small "↑ 12%" note. Higher is better unless `lowerIsBetter`. */
function Delta({ now, before, unit = "%", lowerIsBetter = false, points = false }: { now: number | null; before: number | null; unit?: string; lowerIsBetter?: boolean; points?: boolean }) {
  if (now == null || before == null || (!points && before === 0)) return <span className="faint">no earlier data</span>;
  const diff = points ? Math.round((now - before) * 10) / 10 : Math.round(((now - before) / before) * 100);
  if (diff === 0) return <span className="faint">same as before</span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return <span className={good ? "an-up" : "an-down"}>{diff > 0 ? "↑" : "↓"} {Math.abs(diff)}{points ? " pts" : unit} vs previous period</span>;
}

const pctText = (v: number | null) => (v == null ? "–" : `${v}%`);
const ms = (v: number | null) => (v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

function Tile({ label, value, foot }: { label: string; value: string; foot: React.ReactNode }) {
  return <div className="card stat"><span className="stat-label">{label}</span><span className="stat-value">{value}</span><span className="stat-foot">{foot}</span></div>;
}

export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  const { project: p } = projectAccess(user.id, Number((await params).id));
  const days = (RANGES as readonly number[]).includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const a = chatAnalytics(p.id, days);
  const k: Kpis = a.kpis, b: Kpis = a.previous;
  const base = `/app/p/${p.id}`;
  const latestAudit = get<{ id: number }>("SELECT id FROM audits WHERE project_id = ? AND status IN ('done', 'live') ORDER BY id DESC LIMIT 1", p.id)?.id;
  const feedbackUrl = `${(process.env.APP_URL || "https://proofmyai.com").replace(/\/+$/, "")}/api/v1/feedback`;
  const jsSnippet = `// When a customer clicks 👍 or 👎 under a bot reply:
fetch("${feedbackUrl}", {
  method: "POST",
  headers: { "Authorization": "Bearer ${p.api_key}", "Content-Type": "application/json" },
  body: JSON.stringify({ conversation_id: "same-id-you-send-to-chat-events", rating: "up" }) // "up" | "down" | 1-5
});`;
  const maxShare = Math.max(1, ...a.topics.map((t) => t.share));

  return (
    <div>
      <PageHeader title="Chatbot analytics" subtitle="What customers ask, how well your bot answers, and how happy they are" actions={
        <div className="tabs" style={{ margin: 0 }}>
          {RANGES.map((d) => <Link key={d} href={`${base}/analytics?days=${d}`} className={`tab ${d === days ? "active" : ""}`}>{d} days</Link>)}
        </div>
      } />

      {k.replies === 0 ? (
        <Empty icon="📈" title={`No chatbot conversations in the last ${days} days`}>
          Connect your chatbot or upload chats and this page fills in automatically: topics, accuracy, resolution rate, response times and customer satisfaction.
          <div className="row" style={{ justifyContent: "center", marginTop: 12, gap: 8 }}><Link className="btn btn-sm" href={`${base}/connect#chatbot`}>Connect a chatbot</Link></div>
        </Empty>
      ) : (
        <>
          <div className="grid grid-3 an-kpis">
            <Tile label="Conversations" value={k.conversations.toLocaleString("en-US")} foot={<Delta now={k.conversations} before={b.conversations} />} />
            <Tile label="Answer accuracy" value={pctText(k.accuracy)} foot={<Delta now={k.accuracy} before={b.accuracy} points />} />
            <Tile label="Resolution rate" value={pctText(k.resolution)} foot={<>Conversations with only correct answers and no repeats · <Delta now={k.resolution} before={b.resolution} points /></>} />
            <Tile label="Customer satisfaction" value={k.ratings ? pctText(k.satisfaction) : "–"} foot={k.ratings ? `${k.ratings} rating${k.ratings === 1 ? "" : "s"} 👍👎` : <a href="#collect-feedback">Start collecting 👍/👎 ratings</a>} />
            <Tile label="Needed a human" value={pctText(k.escalation)} foot={<Delta now={k.escalation} before={b.escalation} points lowerIsBetter />} />
            <Tile label="Response time" value={ms(k.latencyAvg)} foot={k.latencyP95 != null ? `average · 95% under ${ms(k.latencyP95)}` : "Send latency_ms with live events to see this"} />
          </div>
          <p className="faint" style={{ fontSize: 13, margin: "-4px 0 14px" }}>
            {k.replies.toLocaleString("en-US")} bot replies checked · {k.repliesPerConversation ?? "–"} {k.repliesPerConversation === 1 ? "reply" : "replies"} per conversation{k.botCost ? ` · bot AI cost $${k.botCost.toFixed(2)}` : ""}
          </p>

          <div className="grid grid-2">
            <div className="card">
              <div className="card-head"><div><h3>Conversations per day</h3><span className="sub">Hover a bar for details</span></div></div>
              <ConversationsChart points={a.daily} />
            </div>
            <div className="card">
              <div className="card-head"><div><h3>Answer accuracy per day</h3><span className="sub">Share of bot replies graded correct</span></div></div>
              <AccuracyChart points={a.daily} />
            </div>
          </div>
          <details className="an-table-toggle">
            <summary className="sub">Show the daily numbers as a table</summary>
            <div className="table-wrap"><table>
              <thead><tr><th>Day</th><th>Conversations</th><th>Replies</th><th>Accuracy</th></tr></thead>
              <tbody>{a.daily.filter((d) => d.replies).reverse().map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.conversations}</td><td>{d.replies}</td><td>{pctText(d.accuracy)}</td></tr>)}</tbody>
            </table></div>
          </details>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><div><h3>🗂️ What customers ask about</h3><span className="sub">Topics found in your bot&apos;s conversations, with how well it handles each one</span></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Topic</th><th style={{ width: "34%" }}>Share of questions</th><th>Accuracy</th><th>Satisfaction</th><th>Problems</th></tr></thead>
                <tbody>
                  {a.topics.slice(0, 15).map((t) => (
                    <tr key={t.topic}>
                      <td><strong>{t.topic}</strong><div className="faint" style={{ fontSize: 12 }}>{t.conversations} conversation{t.conversations === 1 ? "" : "s"}</div></td>
                      <td><div className="an-share"><span style={{ width: `${(t.share / maxShare) * 100}%` }} /></div><span className="faint" style={{ fontSize: 12 }}>{t.share}% · {t.replies} replies</span></td>
                      <td><span className={`badge ${t.accuracy == null ? "" : t.accuracy >= 90 ? "badge-ok" : t.accuracy >= 70 ? "badge-warn" : "badge-bad"}`}>{t.accuracy == null ? "–" : `${t.accuracy >= 90 ? "✓" : t.accuracy >= 70 ? "!" : "✕"} ${t.accuracy}%`}</span></td>
                      <td>{t.ratings ? `${t.satisfaction}% 👍` : <span className="faint">–</span>}</td>
                      <td>{t.problems ? <Link href={`${base}/chatbot`}>{t.problems} to fix →</Link> : <span className="faint">none</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><div><h3>❓ Questions your help docs don&apos;t answer</h3><span className="sub">Customers asked these and your bot had nothing in your docs to answer from</span></div>
              {latestAudit ? <Link className="btn btn-sm" href={`${base}/chatbot/audit/${latestAudit}#fixes`}>✨ Fix with AI</Link> : null}
            </div>
            {a.gaps.length ? (
              <ul className="an-gaps">
                {a.gaps.map((g) => <li key={g.question}><span className="badge">{g.topic}</span> <strong>“{g.question}”</strong>{g.count > 1 ? <span className="faint"> · asked {g.count}×</span> : null}<div className="sub" style={{ margin: "2px 0 0" }}>{g.reason}</div></li>)}
              </ul>
            ) : <p className="sub" style={{ margin: 0 }}>🎉 None in this period. Your help docs cover what customers asked.</p>}
          </div>
        </>
      )}

      <div className="card" id="collect-feedback" style={{ marginTop: 16 }}>
        <div className="card-head"><div><h3>👍👎 Collect customer feedback</h3><span className="sub">Add thumbs up/down (or 1–5 stars) under your bot&apos;s replies and send each click here. You&apos;ll see satisfaction overall and per topic, and which conversations customers disliked.</span></div></div>
        <pre>{jsSnippet}</pre>
        <div className="row" style={{ gap: 8 }}><CopyButton text={jsSnippet} label="Copy code" /><span className="faint" style={{ fontSize: 12 }}>Works from your website, n8n/Make (HTTP Request node) or any backend. Don&apos;t put the API key in public browser code; send it from your server.</span></div>
      </div>
    </div>
  );
}
