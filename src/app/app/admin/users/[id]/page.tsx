import Link from "next/link";
import { userMonthCost } from "@/lib/aicost";
import { isBlocked } from "@/lib/blocklist";
import { twoFactorEnabled } from "@/lib/twofactor";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { isAdmin, requireAdmin, userDetail } from "@/lib/admin";
import { paddleEnv, type Resource } from "@/lib/billing";
import { adminDisableTwoFactorAction, blockUserAction, deleteUserAction, saveNoteAction, sendResetAction, setPlanAction, signOutUserAction, suspendAction } from "../../actions";
import { AdminShell, ago, PlanBadge } from "../../ui";

export const metadata = { title: "Admin · User" };
export const dynamic = "force-dynamic";

const LABELS: [Resource, string][] = [["projects", "Projects"], ["conversations", "Conversations"], ["bots", "Bots with tests"], ["monitors", "Workflows + agents"]];

export default async function AdminUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const admin = await requireAdmin();
  const d = userDetail(Number((await params).id));
  if (!d) notFound();
  const flash = await searchParams;
  const { user: u, billing: b } = d;
  const self = u.email === admin.email;
  const paddleUrl = paddleEnv() === "production" ? "https://vendors.paddle.com" : "https://sandbox-vendors.paddle.com";
  const hidden = <input type="hidden" name="userId" value={u.id} />;

  return (
    <AdminShell>
      <p className="sub"><Link href="/app/admin">← All users</Link></p>
      <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ margin: 0, wordBreak: "break-all" }}>{u.email}</h1>
        <PlanBadge plan={u.plan} status={u.plan_status} cancelAt={u.plan_cancel_at} suspended={u.suspended_at} owner={isAdmin(u.email)} />
      </div>
      <Flash {...flash} />

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <div className="card stat"><span className="stat-label">Signed up</span><strong>{u.created_at.slice(0, 10)}</strong><span className="stat-foot">{ago(u.created_at)}</span></div>
        <div className="card stat"><span className="stat-label">Last active</span><strong>{ago(u.last_seen_at)}</strong><span className="stat-foot">{d.sessions} logged-in device{d.sessions === 1 ? "" : "s"}</span></div>
        <div className="card stat"><span className="stat-label">Plan limits in use</span><strong>{b.plan.name}</strong><span className="stat-foot">{u.plan_status ?? "no subscription"}</span></div>
        <div className="card stat"><span className="stat-label">Account</span><strong>{u.suspended_at ? "Suspended" : "Active"}</strong><span className="stat-foot">{u.suspended_at ? `since ${u.suspended_at.slice(0, 10)}` : "can log in"}</span></div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Billing</h2>
          <table><tbody>
            <tr><td className="faint">Status</td><td>{u.plan_status ?? "Free (never subscribed)"}</td></tr>
            {u.trial_ends_at ? <tr><td className="faint">Trial ends</td><td>{u.trial_ends_at.slice(0, 10)}</td></tr> : null}
            {u.plan_renews_at ? <tr><td className="faint">Next payment</td><td>{u.plan_renews_at.slice(0, 10)}</td></tr> : null}
            {u.plan_cancel_at ? <tr><td className="faint">Cancels on</td><td>{u.plan_cancel_at.slice(0, 10)}</td></tr> : null}
            <tr><td className="faint">Paddle customer</td><td>{u.paddle_customer_id ? <a href={`${paddleUrl}/customers-v2/${u.paddle_customer_id}`} target="_blank" rel="noreferrer">{u.paddle_customer_id} ↗</a> : "none"}</td></tr>
            <tr><td className="faint">Subscription</td><td>{u.paddle_subscription_id ? <a href={`${paddleUrl}/subscriptions-v2/${u.paddle_subscription_id}`} target="_blank" rel="noreferrer">{u.paddle_subscription_id} ↗</a> : "none"}</td></tr>
          </tbody></table>
          <p className="faint" style={{ marginBottom: 0 }}>Refunds, cancellations and card changes are done in Paddle (links above).</p>
        </div>
        <div className="card">
          <h2>Usage</h2>
          {LABELS.map(([k, label]) => {
            const limit = b.plan[k];
            const finite = Number.isFinite(limit);
            const pct = finite ? Math.min(100, Math.round((d.usage[k] / Math.max(1, limit)) * 100)) : 0;
            return (
              <div key={k} style={{ marginBottom: 10 }}>
                <div className="row between"><span className="sub" style={{ margin: 0 }}>{label}</span><strong>{d.usage[k]}{finite ? ` / ${limit}` : " (no limit)"}</strong></div>
                {finite ? <div className="progress" style={{ marginTop: 4 }}><span style={{ width: `${pct}%`, background: pct >= 100 ? "var(--bad)" : undefined }} /></div> : null}
              </div>
            );
          })}
          {(() => {
            const c = userMonthCost(u.id);
            return (
              <div className="row between" style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <span className="sub" style={{ margin: 0 }}>💰 AI cost this month</span>
                <strong><Link href="/app/admin/costs">${c.cost.toFixed(2)}</Link> <span className="faint">({c.calls.toLocaleString()} checks)</span></strong>
              </div>
            );
          })()}
        </div>
      </div>

      <div className="card">
        <h2>Projects ({d.projects.length})</h2>
        {d.projects.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Created</th><th>Help docs</th><th>Audits</th><th>Conversations</th><th>Agent runs</th><th>Workflows</th><th>Bots</th><th>Open incidents</th></tr></thead>
              <tbody>{d.projects.map((p) => (
                <tr key={p.id}><td>{p.name}</td><td>{p.created_at.slice(0, 10)}</td><td>{p.kb}</td><td>{p.audits}</td><td>{p.conversations}</td><td>{p.agentRuns}</td><td>{p.workflows}</td><td>{p.bots}</td><td>{p.openIncidents}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="sub">No projects.</p>}
        <p className="faint" style={{ marginBottom: 0 }}>For privacy, customer transcripts and keys are not shown here.</p>
      </div>

      <div className="grid grid-2">
        <form action={setPlanAction} className="card">
          <h2>Give a plan for free</h2>
          <p className="sub">For friends, partners, beta testers or support cases. This does <strong>not</strong> charge or change anything in Paddle{u.paddle_subscription_id ? "; if they have a Paddle subscription, a later Paddle update will replace this" : ""}.</p>
          {hidden}
          <div className="row" style={{ gap: 8 }}>
            <select name="plan" defaultValue={u.plan_status === "comped" ? u.plan : "growth"} aria-label="Plan">
              <option value="starter">Starter</option><option value="growth">Growth</option><option value="agency">Agency</option><option value="compliance">Compliance</option><option value="free">Free (remove plan)</option>
            </select>
            <SubmitButton pendingText="Saving…">Apply</SubmitButton>
          </div>
        </form>
        <form action={saveNoteAction} className="card">
          <h2>Private note</h2>
          {hidden}
          <textarea name="note" rows={3} defaultValue={u.admin_note ?? ""} placeholder="e.g. Agency from Dubai, met on Upwork, wants Zendesk import" maxLength={2000} style={{ width: "100%" }} />
          <SubmitButton className="btn btn-ghost" pendingText="Saving…">Save note</SubmitButton>
        </form>
      </div>

      <div className="card">
        <h2>Account actions</h2>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <form action={sendResetAction}>{hidden}<SubmitButton className="btn btn-ghost" pendingText="Sending…">✉ Send password reset email</SubmitButton></form>
          <form action={signOutUserAction}>{hidden}<SubmitButton className="btn btn-ghost" pendingText="Signing out…">Sign out all devices</SubmitButton></form>
          {twoFactorEnabled(u.id) ? (
            <form action={adminDisableTwoFactorAction}>{hidden}<SubmitButton className="btn btn-ghost" pendingText="Removing…" confirm={`Remove two-factor authentication for ${u.email}? Only do this after confirming their identity (e.g. they lost their phone).`}>🛡️ Remove 2FA (lost phone)</SubmitButton></form>
          ) : null}
          {self ? null : u.suspended_at ? (
            <form action={suspendAction}>{hidden}<input type="hidden" name="suspend" value="0" /><SubmitButton pendingText="Saving…">Re-activate account</SubmitButton></form>
          ) : (
            <form action={suspendAction}>{hidden}<input type="hidden" name="suspend" value="1" /><SubmitButton className="btn btn-danger" pendingText="Suspending…" confirm={`Suspend ${u.email}? They will be logged out and their API keys stop working.`}>Suspend account</SubmitButton></form>
          )}
          {self || isAdmin(u.email) ? null : isBlocked(u.email) ? (
            <span className="badge badge-bad">⛔ Email blocked: <Link href="/app/admin/blocklist">manage</Link></span>
          ) : (
            <form action={blockUserAction}>{hidden}<SubmitButton className="btn btn-danger" pendingText="Blocking…" confirm={`Block ${u.email}? The account is suspended and this email can never sign up again (you can undo it in the Blocklist).`}>⛔ Block email</SubmitButton></form>
          )}
        </div>
      </div>

      {self ? null : (
        <form action={deleteUserAction} className="card" style={{ borderColor: "var(--bad)" }}>
          <h2>Delete user</h2>
          <p className="sub">Permanently deletes this account, all projects and all data. This cannot be undone.{u.paddle_subscription_id && ["active", "trialing", "past_due"].includes(u.plan_status ?? "") ? " ⚠️ They still have an active Paddle subscription: cancel it in Paddle first, or they will keep being charged." : ""}</p>
          {hidden}
          <div className="field"><label htmlFor="confirm">Type <strong>{u.email}</strong> to confirm</label><input id="confirm" name="confirm" autoComplete="off" /></div>
          <SubmitButton className="btn btn-danger" pendingText="Deleting…">Delete user and all data</SubmitButton>
        </form>
      )}

      <div className="card">
        <h2>History</h2>
        {d.log.length ? (
          <table><tbody>{d.log.map((l, i) => <tr key={i}><td>{ago(l.created_at)}</td><td>{l.action.replace(/_/g, " ")}</td><td className="faint">{l.detail}</td><td className="faint">{l.admin_email}</td></tr>)}</tbody></table>
        ) : <p className="sub">No admin actions on this user yet.</p>}
      </div>
    </AdminShell>
  );
}
