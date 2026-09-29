import Link from "next/link";
import { AutoRefresh } from "@/components/client";
import { PublicPage } from "@/components/site";
import { averageUptime, components, overall, uptimeHistory, type Health } from "@/lib/status";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "System status",
  description: "Live status of ProofMyAI: website, data API, database, background checks, AI checking, email alerts and billing.",
  alternates: { canonical: "/status" },
};

const LABEL: Record<Health, string> = { operational: "Operational", degraded: "Degraded", outage: "Outage", not_configured: "Not active" };
const HEADLINE: Record<Health, string> = {
  operational: "All systems operational",
  degraded: "Some features are degraded",
  outage: "Service disruption",
  not_configured: "All systems operational",
};

export default function StatusPage() {
  const list = components();
  const state = overall(list);
  const history = uptimeHistory(30);
  const avg = averageUptime(history);
  const notice = process.env.STATUS_NOTICE?.trim();
  return (
    <PublicPage title="System status">
      <AutoRefresh active ms={60000} />
      <div className={`status-hero status-${state}`} role="status">
        <span className="status-dot" aria-hidden />
        <div>
          <strong>{HEADLINE[state]}</strong>
          <div className="faint">Checked live just now · refreshes every minute</div>
        </div>
      </div>
      {notice ? <div className="alert alert-warn" style={{ marginTop: 14 }}><strong>Notice:</strong> {notice}</div> : null}

      <div className="card status-list" style={{ marginTop: 18 }}>
        {list.map((c) => (
          <div key={c.name} className="status-row">
            <div>
              <strong><span aria-hidden>{c.icon} </span>{c.name}</strong>
              <div className="faint">{c.description}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className={`status-pill status-${c.health}`}>{LABEL[c.health]}</span>
              <div className="faint">{c.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <h2>📈 Background checks, last 30 days</h2>
      <p className="sub">Share of scheduled checks (every 15 minutes: n8n/Make polling, nightly tests, missing-reply alerts) that ran successfully.{avg !== null ? <> Average: <strong>{avg.toFixed(2)}%</strong>.</> : " History starts with the first scheduled run."}</p>
      <div className="uptime-bars" aria-label="Daily background check uptime">
        {history.map((d) => (
          <span
            key={d.day}
            className={`uptime-bar ${d.pct === null ? "none" : d.pct >= 99 ? "good" : d.pct >= 90 ? "warn" : "bad"}`}
            title={d.pct === null ? `${d.day}: no data` : `${d.day}: ${d.pct.toFixed(1)}% (${d.runs} runs${d.failures ? `, ${d.failures} failed` : ""})`}
          />
        ))}
      </div>
      <div className="row between faint" style={{ fontSize: 12 }}><span>30 days ago</span><span>Today</span></div>

      <h2>🔔 Get notified</h2>
      <p>Problems that affect your own projects are sent through your alert channels (Settings → Notifications). For platform-wide issues, check this page or <Link href="/support">contact support</Link>. Developers can poll <code>/api/health</code>, which returns <code>200</code> when the service is up. See the <Link href="/changelog">changelog</Link> for recent updates.</p>
    </PublicPage>
  );
}
