import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { adoption, atRiskCustomers, channels, funnel, metricsHistory, recordDailyMetrics, retention, revenue, signupsByDay, topCustomers } from "@/lib/analytics";
import { PLANS, type PlanId } from "@/lib/billing";
import { AdminShell, ago } from "../ui";
import { SITE_URL } from "@/lib/seo";

export const metadata = { title: "Admin · Analytics" };
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const RANGES = { "30": "Last 30 days", "90": "Last 90 days", all: "All time" } as const;

function Bars({ data, format, label }: { data: { day: string; value: number }[]; format: (v: number) => string; label: string }) {
  const max = Math.max(0.0001, ...data.map((d) => d.value));
  return (
    <div className="cost-bars" role="img" aria-label={label}>
      {data.map((d) => (
        <div key={d.day} className="cost-bar" title={`${d.day}: ${format(d.value)}`}>
          <span style={{ height: `${d.value ? Math.max(3, (d.value / max) * 100) : 0}%` }} />
        </div>
      ))}
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdmin();
  const { range: r } = await searchParams;
  const range = r && r in RANGES ? (r as keyof typeof RANGES) : "30";
  recordDailyMetrics(); // keep today's snapshot fresh even before the cron runs
  const steps = funnel(range === "all" ? null : Number(range));
  const byChannel = channels(range === "all" ? null : Number(range));
  const cohorts = retention(8);
  const features = adoption();
  const rev = revenue();
  const history = metricsHistory(90);
  const signups = signupsByDay(range === "90" ? 90 : 30);
  const risk = atRiskCustomers();
  const top = topCustomers(10);
  const top0 = steps[0].count || 1;

  return (
    <AdminShell>
      <div className="analytics">
      <p className="sub"><Link href="/app/admin">← Admin dashboard</Link></p>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>📊 Advanced analytics</h1>
        <div className="tabs" style={{ margin: 0 }}>
          {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => <Link key={k} href={`/app/admin/analytics?range=${k}`} className={`tab ${k === range ? "active" : ""}`}>{RANGES[k]}</Link>)}
        </div>
      </div>

      <h2>💵 Revenue</h2>
      <div className="grid grid-4">
        <div className="card stat"><span className="stat-label">MRR</span><span className="stat-value">{usd(rev.mrr)}</span><span className="stat-foot">ARR {usd(rev.arr)}</span></div>
        <div className="card stat"><span className="stat-label">Paying customers</span><span className="stat-value">{rev.paying}</span><span className="stat-foot">ARPU {usd(rev.arpu)} / month</span></div>
        <div className="card stat"><span className="stat-label">Trial → paid</span><span className="stat-value">{pct(rev.trialConversion)}</span><span className="stat-foot">{rev.trialConverted} of {rev.trialsEnded} finished trials</span></div>
        <div className="card stat"><span className="stat-label">Churn (30 days)</span><span className="stat-value" style={{ color: rev.churnRate && rev.churnRate > 0.08 ? "var(--bad)" : undefined }}>{pct(rev.churnRate)}</span><span className="stat-foot">{rev.churned30} cancelled · gross margin after AI {pct(rev.grossMargin)}</span></div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>📈 MRR history (90 days)</h3>
          {history.length > 1 ? <Bars data={history.map((h) => ({ day: h.day, value: h.mrr }))} format={usd} label="MRR per day" /> : <p className="sub">History builds up from today: one snapshot a day.</p>}
        </div>
        <div className="card">
          <h3>🧾 Revenue by plan</h3>
          <table><tbody>
            {rev.byPlan.map((p) => (
              <tr key={p.plan}><td>{p.name} <span className="faint">{usd(PLANS[p.plan as PlanId].price)}</span></td><td style={{ textAlign: "right" }}>{p.paying} paying</td><td style={{ textAlign: "right" }}><strong>{usd(p.mrr)}</strong></td>
                <td style={{ width: "30%" }}><div className="progress"><span style={{ width: `${rev.mrr ? (p.mrr / rev.mrr) * 100 : 0}%` }} /></div></td></tr>
            ))}
          </tbody></table>
        </div>
      </div>

      <h2>🪜 Conversion funnel <span className="faint" style={{ fontSize: 14 }}>({RANGES[range].toLowerCase()} sign-ups)</span></h2>
      <div className="card">
        {steps.map((s, i) => {
          const prev = i ? steps[i - 1].count : s.count;
          return (
            <div key={s.label} className="funnel-row">
              <div className="funnel-label"><strong>{i + 1}. {s.label}</strong><span className="faint">{s.hint}</span></div>
              <div className="funnel-bar"><span style={{ width: `${(s.count / top0) * 100}%` }} /></div>
              <div className="funnel-num"><strong>{s.count}</strong> <span className="faint">{pct(s.count / top0)}{i ? ` · ${pct(prev ? s.count / prev : null)} of previous` : ""}</span></div>
            </div>
          );
        })}
        <p className="faint" style={{ marginTop: 10 }}>The biggest drop between two steps is where to improve first (onboarding emails, setup guide, pricing page).</p>
      </div>

      <h2>📣 Sign-ups by channel <span className="faint" style={{ fontSize: 14 }}>(which marketing works)</span></h2>
      <div className="card" style={{ overflowX: "auto" }}>
        {byChannel.length === 0 ? <p className="sub" style={{ margin: 0 }}>No sign-ups or leads in this period yet.</p> : (
          <table>
            <thead><tr><th>Channel</th><th style={{ textAlign: "right" }}>Leads</th><th style={{ textAlign: "right" }}>Sign-ups</th><th style={{ textAlign: "right" }}>Connected data</th><th style={{ textAlign: "right" }}>Paying</th></tr></thead>
            <tbody>
              {byChannel.map((c) => (
                <tr key={c.channel}>
                  <td><strong>{c.channel}</strong></td>
                  <td style={{ textAlign: "right" }}>{c.leads}</td>
                  <td style={{ textAlign: "right" }}>{c.signups}</td>
                  <td style={{ textAlign: "right" }}>{c.connected} <span className="faint">{c.signups ? pct(c.connected / c.signups) : ""}</span></td>
                  <td style={{ textAlign: "right" }}><strong>{c.paying}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="faint" style={{ marginTop: 10 }}>
          Add <code>?utm_source=…</code> to every link you share so it is credited, e.g. <code>{SITE_URL}/free-audit?utm_source=linkedin</code>,
          <code>{SITE_URL}/?utm_source=reddit&amp;utm_campaign=n8n_post</code>. Visits are remembered only for visitors who accept analytics cookies; UTM links to /free-audit always count.
        </p>
      </div>

      <h2>🔁 Weekly retention</h2>
      <div className="card">
        <p className="sub">Share of each week&apos;s sign-ups who came back and used the app in the following weeks. Activity is recorded when a logged-in user opens the dashboard.</p>
        <div className="table-wrap">
          <table className="cohort">
            <thead><tr><th>Signed up (week of)</th><th>Users</th>{cohorts.map((_, k) => <th key={k}>Week {k}</th>)}</tr></thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.week}>
                  <td>{c.week}</td><td>{c.size}</td>
                  {c.weeks.map((w, k) => <td key={k} style={w === null ? undefined : { background: `color-mix(in srgb, var(--brand) ${Math.round(w * 70)}%, transparent)`, color: w > 0.5 ? "#fff" : undefined }}>{w === null ? "" : pct(w)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>🧩 Feature adoption</h3>
          <p className="sub">Share of all users who have used each feature.</p>
          {features.map((f) => (
            <div key={f.feature} style={{ marginBottom: 10 }}>
              <div className="row between"><span>{f.feature}</span><strong>{f.users} <span className="faint">({pct(f.share)})</span></strong></div>
              <div className="progress" style={{ marginTop: 4 }}><span style={{ width: `${f.share * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>🆕 Sign-ups per day</h3>
          <Bars data={signups.map((s) => ({ day: s.day, value: s.count }))} format={(v) => `${v} sign-ups`} label="Sign-ups per day" />
          <p className="faint">{signups.reduce((s, d) => s + d.count, 0)} sign-ups in the last {signups.length} days.</p>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>⚠️ Customers at risk ({risk.length})</h3>
          {risk.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Customer</th><th>Plan</th><th>Why</th><th>Last active</th></tr></thead>
              <tbody>{risk.map((c) => <tr key={c.id}><td><Link href={`/app/admin/users/${c.id}`}>{c.email}</Link></td><td>{PLANS[c.plan as PlanId]?.name ?? c.plan}</td><td>{c.reason}</td><td>{ago(c.last_seen_at)}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="sub">No paying customers look at risk right now. 🎉</p>}
          <p className="faint">Reach out personally (WhatsApp or email) before they cancel.</p>
        </div>
        <div className="card">
          <h3>🏆 Most active customers (this month)</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Customer</th><th>Plan</th><th>Conversations</th><th>Runs</th></tr></thead>
            <tbody>{top.length === 0 ? <tr><td colSpan={4} className="faint">No usage yet this month.</td></tr> : null}{top.map((c) => <tr key={c.id}><td><Link href={`/app/admin/users/${c.id}`}>{c.email}</Link></td><td>{PLANS[c.plan as PlanId]?.name ?? c.plan}</td><td>{c.conversations}</td><td>{c.runs}</td></tr>)}</tbody>
          </table></div>
          <p className="faint">Your best testimonial and case-study candidates.</p>
        </div>
      </div>
      </div>
    </AdminShell>
  );
}
