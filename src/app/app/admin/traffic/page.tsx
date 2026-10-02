import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { trafficSummary } from "@/lib/traffic";
import { AdminShell } from "../ui";

export const metadata = { title: "Admin · Website traffic" };
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;

export default async function AdminTrafficPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const asked = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 30;
  const t = trafficSummary(days);
  const max = Math.max(1, ...t.daily.map((d) => d.visitors));
  const topSource = Math.max(1, ...t.sources.map((s) => s.visits));
  const topPage = Math.max(1, ...t.pages.map((p) => p.views));
  return (
    <AdminShell>
      <p className="sub"><Link href="/app/admin">← Admin dashboard</Link></p>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>🌍 Website traffic</h1>
        <div className="tabs" style={{ margin: 0 }}>
          {RANGES.map((r) => <Link key={r} href={`/app/admin/traffic?days=${r}`} className={`tab ${r === days ? "active" : ""}`}>Last {r} days</Link>)}
        </div>
      </div>
      <p className="sub">Public pages only, counted without cookies (no consent banner needed). Bots and dashboard pages are not counted.</p>

      <div className="grid grid-3">
        <div className="card stat"><div className="stat-label">Visitors</div><div className="stat-value">{t.visitors.toLocaleString()}</div></div>
        <div className="card stat"><div className="stat-label">Page views</div><div className="stat-value">{t.views.toLocaleString()}</div></div>
        <div className="card stat"><div className="stat-label">Pages per visitor</div><div className="stat-value">{t.visitors ? (t.views / t.visitors).toFixed(1) : "–"}</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Visitors per day</h3>
        <div className="cost-bars" role="img" aria-label={`Visitors per day for the last ${days} days`}>
          {t.daily.map((d) => (
            <div key={d.day} className="cost-bar" title={`${d.day}: ${d.visitors} visitors, ${d.views} views`}>
              <span style={{ height: `${Math.max(2, (d.visitors / max) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="row between faint" style={{ fontSize: 12 }}><span>{t.daily[0]?.day}</span><span>{t.daily.at(-1)?.day}</span></div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Where visitors come from</h3>
          {t.sources.length ? t.sources.map((s) => (
            <div key={s.source} className="traffic-row">
              <span>{s.source}</span><b>{s.visits}</b>
              <i style={{ width: `${(s.visits / topSource) * 100}%` }} />
            </div>
          )) : <p className="faint">No visits yet.</p>}
          <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>Tip: add <code>?utm_source=linkedin</code> to links you share to see them here by name.</p>
        </div>
        <div className="card">
          <h3>Top pages</h3>
          {t.pages.length ? t.pages.map((p) => (
            <div key={p.path} className="traffic-row">
              <a href={p.path} target="_blank" rel="noopener">{p.path}</a><b>{p.views}</b>
              <i style={{ width: `${(p.views / topPage) * 100}%` }} />
            </div>
          )) : <p className="faint">No visits yet.</p>}
        </div>
      </div>
    </AdminShell>
  );
}
