import Link from "next/link";
import { AutoRefresh } from "@/components/client";
import { PublicPage } from "@/components/site";
import { lastBackup, lastRestoreTest } from "@/lib/backup";
import { averageUptime, components, overall, uptimeHistory, type Component, type Day, type Health } from "@/lib/status";

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

function backupRow(now = new Date()): Component {
  const b = lastBackup();
  const t = lastRestoreTest();
  if (!b) return { icon: "💾", name: "Backups", description: "Daily encrypted backup, with an automatic restore test", health: "not_configured", detail: "Waiting for the first backup" };
  const hours = (now.getTime() - Date.parse(b.at)) / 3600000;
  const day = b.at.slice(0, 10);
  const restored = t && t.at.slice(0, 10) === day;
  return {
    icon: "💾", name: "Backups", description: "Daily encrypted backup, with an automatic restore test",
    health: !b.ok || hours > 36 || (restored && !t.ok) ? "degraded" : "operational",
    detail: `Last backup ${day}${restored ? (t.ok ? " · restore test passed" : " · restore test failed") : ""}`,
  };
}

/** Days in the last 30 where background checks fell short: the public incident history. */
function pastIncidents(history: Day[]): Day[] {
  return history.filter((d) => d.pct !== null && d.pct < 99).reverse();
}

export default function StatusPage() {
  const list = [...components(), backupRow()];
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
      <p className="sub">Share of scheduled checks (every 15 minutes: n8n/Make, Sheets and CRM polling, heartbeats, nightly tests, missing-reply alerts) that ran successfully.{avg !== null ? <> Average: <strong>{avg.toFixed(2)}%</strong>.</> : " History starts with the first scheduled run."} This measures whether our background checks ran on time. It is not website uptime and not how accurately problems are detected; see the <a href="/benchmark">accuracy benchmark</a> for that.</p>
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

      <h2>🧾 Past incidents, last 30 days</h2>
      {pastIncidents(history).length ? (
        <ul>
          {pastIncidents(history).map((d) => (
            <li key={d.day}><strong>{d.day}</strong>: background checks ran {d.pct!.toFixed(1)}% of the time ({d.runs} runs{d.failures ? `, ${d.failures} with errors` : ""}). Alerts for that day may have been delayed.</li>
          ))}
        </ul>
      ) : <p className="sub">No days with missed or failed background checks in the last 30 days.</p>}
      <p className="sub">Listed automatically: any day where scheduled checks ran less than 99% of the time. Backups are made daily and every backup is restored into a scratch database and checked before it counts.</p>

      <h2>🔔 Get notified</h2>
      <p>Problems that affect your own projects are sent through your alert channels (Settings → Notifications). For platform-wide issues, check this page or <Link href="/support">contact support</Link>. Developers can poll <code>/api/health</code>, which returns <code>200</code> when the service is up. See the <Link href="/changelog">changelog</Link> for recent updates.</p>
    </PublicPage>
  );
}
