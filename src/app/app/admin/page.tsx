import Link from "next/link";
import { Flash } from "@/components/ui";
import { adminStats, isAdmin, listUsers, PAGE_SIZE, recentAdminLog, requireAdmin, SEGMENTS, type Segment } from "@/lib/admin";
import { PLANS } from "@/lib/billing";
import { ticketCounts } from "@/lib/support";
import { SignupChart } from "./SignupChart";
import { AdminShell, ago, PlanBadge } from "./ui";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

const money = (v: number) => `$${v.toLocaleString("en-US")}`;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string; segment?: string; page?: string; ok?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const segment: Segment = sp.segment && sp.segment in SEGMENTS ? (sp.segment as Segment) : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").slice(0, 200);
  const s = adminStats();
  const { rows, total } = listUsers({ q, segment, page });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(segment !== "all" ? { segment } : {}), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    return `/app/admin${p.toString() ? `?${p}` : ""}`;
  };
  const log = recentAdminLog();

  return (
    <AdminShell>
      <h1>Admin dashboard</h1>
      <p className="sub">Everything about your customers in one place. Revenue here is calculated from active plans; Paddle is the source of truth for payouts.</p>
      <Flash ok={sp.ok} error={sp.error} />
      <p><Link className="btn btn-ghost btn-sm" href="/app/admin/support">🎫 Support tickets ({ticketCounts().open} open)</Link></p>

      <div className="grid grid-4">
        <div className="card stat"><span className="stat-label">Monthly revenue (MRR)</span><span className="stat-value">{money(s.mrr)}</span><span className="stat-foot">{money(s.mrr * 12)} per year</span></div>
        <div className="card stat"><span className="stat-label">Paying customers</span><span className="stat-value">{s.paying}</span><span className="stat-foot">{s.trialing} on free trial</span></div>
        <div className="card stat"><span className="stat-label">Users</span><span className="stat-value">{s.users}</span><span className="stat-foot">+{s.new7} this week · +{s.new30} in 30 days</span></div>
        <div className="card stat"><span className="stat-label">Active in last 7 days</span><span className="stat-value">{s.active7}</span><span className="stat-foot">{s.users ? Math.round((s.active7 / s.users) * 100) : 0}% of users</span></div>
      </div>

      {s.pastDue || s.canceling ? (
        <div className="alert alert-warn" style={{ marginTop: 16 }}>
          {s.pastDue ? <><Link href={link({ segment: "past_due" })}><strong>{s.pastDue}</strong> payment{s.pastDue === 1 ? "" : "s"} failed</Link> (Paddle retries automatically). </> : null}
          {s.canceling ? <><Link href={link({ segment: "canceling" })}><strong>{s.canceling}</strong> customer{s.canceling === 1 ? " is" : "s are"} cancelling</Link>: a good moment to ask why.</> : null}
        </div>
      ) : null}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Sign-ups, last 30 days</h2>
          <SignupChart data={s.signups} />
        </div>
        <div className="card">
          <h2>Plans</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Paying</th><th>On trial</th><th>MRR</th></tr></thead>
              <tbody>
                {s.byPlan.map((p) => (
                  <tr key={p.plan}><td>{PLANS[p.plan].name} <span className="faint">{money(PLANS[p.plan].price)}</span></td><td>{p.paying}</td><td>{p.trialing}</td><td>{money(p.paying * PLANS[p.plan].price)}</td></tr>
                ))}
                <tr><td className="faint">Free plan given</td><td colSpan={3}>{s.comped}</td></tr>
                <tr><td className="faint">Suspended</td><td colSpan={3}>{s.suspended}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <div className="card stat"><span className="stat-label">Projects</span><span className="stat-value">{s.projects}</span></div>
        <div className="card stat"><span className="stat-label">Conversations checked (30d)</span><span className="stat-value">{s.conversations30.toLocaleString("en-US")}</span></div>
        <div className="card stat"><span className="stat-label">Agent + workflow runs (30d)</span><span className="stat-value">{(s.agentRuns30 + s.workflowRuns30).toLocaleString("en-US")}</span><span className="stat-foot">{s.agentRuns30} agent · {s.workflowRuns30} workflow</span></div>
        <div className="card stat"><span className="stat-label">Open incidents</span><span className="stat-value">{s.openIncidents}</span><span className="stat-foot">across all customers</span></div>
      </div>

      <div className="card" id="users" style={{ marginTop: 16 }}>
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Users <span className="faint">({total})</span></h2>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <form className="row" style={{ gap: 6 }} action="/app/admin">
              {segment !== "all" ? <input type="hidden" name="segment" value={segment} /> : null}
              <input name="q" type="search" defaultValue={q} placeholder="Search email…" aria-label="Search users by email" style={{ width: 200, padding: "6px 10px" }} />
              <button className="btn btn-ghost btn-sm">Search</button>
            </form>
            <a className="btn btn-ghost btn-sm" href={`/app/admin/export?${new URLSearchParams({ q, segment })}`}>⬇ Export CSV</a>
          </div>
        </div>
        <div className="tabs" style={{ marginTop: 14 }}>
          {(Object.keys(SEGMENTS) as Segment[]).map((k) => (
            <Link key={k} href={link({ segment: k, page: 1 })} className={`tab ${k === segment ? "active" : ""}`}>{SEGMENTS[k].label}</Link>
          ))}
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Email</th><th>Plan</th><th>Signed up</th><th>Last active</th><th>Projects</th><th>Conversations (month)</th></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td style={{ wordBreak: "break-all" }}><Link href={`/app/admin/users/${u.id}`}>{u.email}</Link></td>
                    <td><PlanBadge plan={u.plan} status={u.plan_status} cancelAt={u.plan_cancel_at} suspended={u.suspended_at} owner={isAdmin(u.email)} /></td>
                    <td>{ago(u.created_at)}</td>
                    <td>{ago(u.last_seen_at)}</td>
                    <td>{u.projects}</td>
                    <td>{u.conversations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No users match.</div>}
        {pages > 1 ? (
          <div className="row between" style={{ marginTop: 12 }}>
            {page > 1 ? <Link href={link({ page: page - 1 })}>← Newer</Link> : <span />}
            <span className="faint">Page {page} of {pages}</span>
            {page < pages ? <Link href={link({ page: page + 1 })}>Older →</Link> : <span />}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Admin activity</h2>
        {log.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>User</th><th>Detail</th></tr></thead>
              <tbody>{log.map((l, i) => <tr key={i}><td>{ago(l.created_at)}</td><td>{l.admin_email}</td><td>{l.action.replace(/_/g, " ")}</td><td>{l.target_email ?? ""}</td><td className="faint">{l.detail}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="sub">No admin actions yet. Everything you change here is recorded.</p>}
      </div>
    </AdminShell>
  );
}
