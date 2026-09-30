import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { costSummary, customerCosts, monthStartIso } from "@/lib/aicost";
import { PLANS } from "@/lib/billing";
import { judgeLabel } from "@/lib/judge/llm";
import { AdminShell } from "../ui";

export const metadata = { title: "Admin · AI costs" };
export const dynamic = "force-dynamic";

const usd = (n: number) => (n < 1 && n > 0 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const KIND_LABEL = { audit: "💬 Chatbot audits (uploads)", live: "📡 Live tracking", test: "🧪 Nightly bot tests", agent: "🤖 AI agent reviews" } as const;

export default async function AdminCostsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const { month } = await searchParams;
  const now = new Date();
  const prev = month === "prev";
  const start = prev ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const since = monthStartIso(start);
  const until = monthStartIso(end);
  const s = costSummary(since, until);
  const customers = customerCosts(since, until);
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86400000);
  const daysElapsed = prev ? daysInMonth : Math.max(1, (now.getTime() - start.getTime()) / 86400000);
  const projected = prev ? s.cost : (s.cost / daysElapsed) * daysInMonth;
  const share = s.revenue > 0 ? projected / s.revenue : null;
  const losses = customers.filter((c) => c.flag === "loss").length;
  const watch = customers.filter((c) => c.flag === "watch").length;
  const maxDay = Math.max(0.0001, ...s.daily.map((d) => d.cost));
  const onOpus = /opus|fable/.test(judgeLabel());
  const monthName = start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <AdminShell>
      <p className="sub"><Link href="/app/admin">← Admin dashboard</Link></p>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>💰 AI costs · {monthName}</h1>
        <div className="tabs" style={{ margin: 0 }}>
          <Link href="/app/admin/costs" className={`tab ${!prev ? "active" : ""}`}>This month</Link>
          <Link href="/app/admin/costs?month=prev" className={`tab ${prev ? "active" : ""}`}>Last month</Link>
        </div>
      </div>
      <p className="sub">What the AI checks cost you, per customer, against what they pay. Current AI: <strong>{judgeLabel()}</strong>. Amounts are calculated from token usage at list prices; your exact bill is in the <a href="https://platform.claude.com/usage" target="_blank" rel="noopener">Claude Console → Usage</a>.</p>

      {losses ? <div className="alert alert-bad">🚨 <strong>{losses} customer{losses === 1 ? "" : "s"}</strong> cost{losses === 1 ? "s" : ""} more in AI than they pay this month. See the red rows below.</div> : null}

      <div className="grid grid-4">
        <div className="card stat"><span className="stat-label">AI cost {prev ? "last month" : "so far"}</span><span className="stat-value">{usd(s.cost)}</span><span className="stat-foot">{s.calls.toLocaleString()} AI checks</span></div>
        <div className="card stat"><span className="stat-label">{prev ? "Month total" : "Projected month end"}</span><span className="stat-value">{usd(projected)}</span><span className="stat-foot">{prev ? "final" : `at the current daily rate (${usd(s.cost / daysElapsed)}/day)`}</span></div>
        <div className="card stat"><span className="stat-label">Share of revenue</span><span className="stat-value" style={{ color: share !== null && share >= 0.3 ? "var(--bad)" : undefined }}>{share === null ? "–" : `${Math.round(share * 100)}%`}</span><span className="stat-foot">MRR {usd(s.revenue)} · aim for under 20%</span></div>
        <div className="card stat"><span className="stat-label">Cost per conversation</span><span className="stat-value">{s.perConversation === null ? "–" : usd(s.perConversation)}</span><span className="stat-foot">audits + live tracking</span></div>
      </div>

      {s.daily.length ? (
        <div className="card">
          <h2>📈 Daily AI cost</h2>
          <div className="cost-bars" role="img" aria-label="Daily AI cost">
            {s.daily.map((d) => (
              <div key={d.day} className="cost-bar" title={`${d.day}: ${usd(d.cost)}`}>
                <span style={{ height: `${Math.max(3, (d.cost / maxDay) * 100)}%` }} />
                <small>{d.day.slice(8)}</small>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2>👥 Cost per customer</h2>
        {customers.length === 0 ? (
          <p className="sub">No AI checks yet {prev ? "last month" : "this month"}. Costs appear here as soon as customers run audits, live tracking, tests or agent reviews.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Plan</th><th>Pays / month</th><th>AI cost</th><th>AI checks</th><th>Cost vs revenue</th></tr></thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.userId} className={c.flag === "loss" ? "row-bad" : c.flag === "watch" ? "row-warn" : ""}>
                    <td><Link href={`/app/admin/users/${c.userId}`}>{c.email}</Link></td>
                    <td>{PLANS[c.plan]?.name ?? c.plan}{c.status && c.status !== "active" ? <span className="faint"> · {c.status === "comped" ? "free upgrade" : c.status}</span> : null}</td>
                    <td>{c.revenue ? usd(c.revenue) : <span className="faint">$0</span>}</td>
                    <td><strong>{usd(c.cost)}</strong>{c.unpriced ? <span className="faint"> (+{c.unpriced} unpriced)</span> : null}</td>
                    <td>{c.calls.toLocaleString()}</td>
                    <td>
                      {c.flag === "loss" ? <span className="badge badge-bad">🚨 Loss: {Math.round((c.share ?? 0) * 100)}%</span>
                        : c.flag === "watch" ? <span className="badge badge-warn">⚠️ {c.share === null ? "Free user, high use" : `${Math.round(c.share * 100)}%`}</span>
                        : <span className="badge badge-ok">✓ {c.share === null ? "Low" : `${Math.round(c.share * 100)}%`}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="faint" style={{ marginTop: 10 }}>🚨 Loss = AI costs more than they pay. ⚠️ = AI is over 50% of what they pay, or a free/trial/founding user above $5. Trials, founding customers and free plans bring $0 revenue, so their cost is your marketing spend.</p>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>🧩 By feature</h2>
          <table>
            <tbody>
              {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
                <tr key={k}><td>{KIND_LABEL[k]}</td><td style={{ textAlign: "right" }}>{usd(s.byKind[k].cost)}</td><td className="faint" style={{ textAlign: "right" }}>{s.byKind[k].calls.toLocaleString()} checks</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>🧠 By AI model</h2>
          {s.byModel.length ? (
            <table><tbody>{s.byModel.map((m) => <tr key={m.model}><td className="mono">{m.model}</td><td style={{ textAlign: "right" }}>{usd(m.cost)}</td><td className="faint" style={{ textAlign: "right" }}>{m.calls.toLocaleString()} checks</td></tr>)}</tbody></table>
          ) : <p className="sub">No AI checks yet.</p>}
        </div>
      </div>

      <div className="card">
        <h2>💡 How to lower AI cost</h2>
        <ul>
          {onOpus ? <li><strong>Switch to Claude Sonnet 5.5</strong> (about half the cost): Railway → Variables → set <code>JUDGE_MODEL</code> = <code>claude-sonnet-5-5</code> → Deploy.</li> : null}
          <li><strong>Heavy free users:</strong> check the ⚠️ rows. Suspend abusive accounts or move them to a paid plan from their user page.</li>
          <li><strong>Plan limits:</strong> if a plan is often unprofitable, lower its monthly conversation limit or raise its price.</li>
          <li><strong>Safety net:</strong> set a monthly spend limit in the Claude Console (Settings → Limits).</li>
        </ul>
      </div>
    </AdminShell>
  );
}
