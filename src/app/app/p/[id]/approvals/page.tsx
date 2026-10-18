import Link from "next/link";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { Badge, Empty, Flash, PageHeader, Stat, timeAgo } from "@/components/ui";
import { ruleSuggestions, type Approval } from "@/lib/approvals";
import { requireUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { projectAccess } from "@/lib/projects";
import { addApprovalRuleAction, approvalLimitAction, decideApprovalAction, deleteApprovalRuleAction } from "../actions";

export const metadata = { title: "Approvals" };

const STATUS: Record<Approval["status"], { tone: "ok" | "bad" | "warn" | "muted"; label: string }> = {
  pending: { tone: "warn", label: "Waiting for you" },
  approved: { tone: "ok", label: "Approved" },
  rejected: { tone: "bad", label: "Rejected" },
  expired: { tone: "muted", label: "Expired" },
};

const expiresIn = (iso: string) => {
  const h = Math.round((Date.parse(iso) - Date.now()) / 3600000);
  return h <= 0 ? "expires within the hour" : `expires in ${h}h`;
};

export default async function ApprovalsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { project: p, role } = projectAccess(user.id, Number((await params).id));
  const flash = await searchParams;
  const canDecide = role !== "viewer";
  const pending = all<Approval>("SELECT * FROM approvals WHERE project_id = ? AND status = 'pending' ORDER BY id", p.id);
  const history = all<Approval>("SELECT * FROM approvals WHERE project_id = ? AND status <> 'pending' ORDER BY id DESC LIMIT 100", p.id);
  const rules = all<{ category: string; action: string; created_by: string | null; created_at: string }>("SELECT * FROM approval_rules WHERE project_id = ? ORDER BY created_at DESC", p.id);
  const stats = get<{ total: number; auto: number | null; human: number | null; rejected: number | null }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN auto = 1 THEN 1 ELSE 0 END) AS auto, SUM(CASE WHEN auto = 0 AND status IN ('approved', 'rejected') THEN 1 ELSE 0 END) AS human,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected FROM approvals WHERE project_id = ? AND created_at >= ?`,
    p.id, new Date(Date.now() - 30 * 86400000).toISOString(),
  );
  const suggestions = ruleSuggestions(p.id);
  const limit = get<{ approve_over: number | null }>("SELECT approve_over FROM projects WHERE id = ?", p.id)?.approve_over ?? null;
  const pid = <input type="hidden" name="projectId" value={p.id} />;
  const autoShare = stats?.total ? Math.round(((stats.auto ?? 0) / stats.total) * 100) : null;

  return (
    <div>
      <AutoRefresh active ms={30000} />
      <Flash ok={flash.ok} error={flash.error} />
      <PageHeader title="Approvals" subtitle="Your agents prepare the action. You approve the ones that matter with one click: money, messages to customers, anything that can't be undone." />

      <div className="grid grid-4">
        <Stat label="Waiting for you" value={pending.length} foot={pending.length ? "oldest first" : "nothing to approve"} />
        <Stat label="Approved automatically" value={autoShare == null ? "–" : `${autoShare}%`} foot="last 30 days: grows as you add rules" />
        <Stat label="Decided by a person" value={stats?.human ?? 0} foot="last 30 days" />
        <Stat label="Rejected" value={stats?.rejected ?? 0} foot="retries of these are blocked" />
      </div>

      <h2 style={{ marginTop: 20 }}>Waiting for approval</h2>
      {pending.length === 0 ? (
        <Empty icon="✅" title="Nothing waiting">
          When an agent wants to do something that needs a person (a refund, an email to a customer, a payment, a first-time action), it appears here and you get an alert. <Link href="/docs#approvals">How to connect your agent</Link>
        </Empty>
      ) : (
        <div className="stack">
          {pending.map((a) => (
            <div className="card" key={a.id} id={`a-${a.id}`}>
              <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
                <div>
                  <Badge tone="warn">⏳ {a.action}</Badge>{" "}
                  {a.amount != null ? <Badge tone="info">{a.amount.toLocaleString("en-GB")} {a.currency ?? ""}</Badge> : null}{" "}
                  {a.category ? <Badge>{a.category}</Badge> : null}{" "}
                  {a.reversible === 0 ? <Badge tone="bad">can&apos;t be undone</Badge> : null}
                </div>
                <span className="faint" style={{ fontSize: 13 }}>{a.agent_name ?? "Agent"} · {timeAgo(a.created_at)} · {expiresIn(a.expires_at)}</span>
              </div>
              <h3 style={{ margin: "10px 0 4px" }}>{a.summary}</h3>
              <p className="faint" style={{ margin: 0 }}>Why it needs you: {a.reason}</p>
              {a.commitments ? <p style={{ margin: "6px 0 0", color: "var(--warn)", fontWeight: 600 }}>⚠️ This promises {a.commitments}. Check you&apos;re allowed to commit to it.</p> : null}
              {a.details ? <pre style={{ whiteSpace: "pre-wrap", marginTop: 10, maxHeight: 260, overflow: "auto", background: "var(--surface-2)", padding: 12, borderRadius: 10, fontSize: 14 }}>{a.details}</pre> : null}
              {canDecide ? (
                <form action={decideApprovalAction} style={{ marginTop: 12 }}>
                  {pid}<input type="hidden" name="approvalId" value={a.id} />
                  <div className="field"><label htmlFor={`n-${a.id}`}>Note <span className="hint">(optional, saved with your decision)</span></label><input id={`n-${a.id}`} name="note" type="text" maxLength={500} placeholder="Why you approved or rejected it" /></div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button type="submit" className="btn" name="choice" value="approve">✅ Approve</button>
                    {a.category ? <button type="submit" className="btn btn-ghost" name="choice" value="approve_rule">✅ Approve &amp; always allow “{a.category}”</button> : null}
                    <button type="submit" className="btn btn-danger" name="choice" value="reject">✋ Reject</button>
                  </div>
                </form>
              ) : <p className="faint">Viewers can see requests but not decide them.</p>}
            </div>
          ))}
        </div>
      )}

      {suggestions.length && canDecide ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><div><h3>🎓 Ready to trust</h3><span className="sub">You approved these every time, with no rejections. Make them automatic so your queue shrinks.</span></div></div>
          {suggestions.map((s) => (
            <form key={`${s.category}:${s.action}`} action={addApprovalRuleAction} className="row between" style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
              {pid}<input type="hidden" name="category" value={s.category} /><input type="hidden" name="action" value={s.action} />
              <span><b>{s.action}</b> for <b>{s.category}</b> · approved {s.approved}× by your team</span>
              <SubmitButton className="btn btn-sm" pendingText="…">Make automatic</SubmitButton>
            </form>
          ))}
        </div>
      ) : null}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><div><h3>📏 Your rules</h3><span className="sub">Actions approved automatically, by category</span></div></div>
          {rules.length === 0 ? <p className="faint">No rules yet. Use “Approve & always allow” on a request.</p> : rules.map((r) => (
            <form key={`${r.category}:${r.action}`} action={deleteApprovalRuleAction} className="row between" style={{ padding: "6px 0" }}>
              {pid}<input type="hidden" name="category" value={r.category} /><input type="hidden" name="action" value={r.action} />
              <span><b>{r.action}</b> for <b>{r.category}</b> <span className="faint">· by {r.created_by ?? "you"}</span></span>
              {canDecide ? <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Remove</SubmitButton> : null}
            </form>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><div><h3>💷 Amount limit</h3><span className="sub">Any action with an amount at or over this waits for a person</span></div></div>
          {role === "owner" ? (
            <form action={approvalLimitAction} className="row" style={{ gap: 8 }}>
              {pid}<input name="approve_over" type="number" min={0} step="any" defaultValue={limit ?? ""} placeholder="e.g. 50" style={{ maxWidth: 160 }} />
              <SubmitButton className="btn btn-sm" pendingText="Saving…">Save</SubmitButton>
            </form>
          ) : <p>{limit == null ? "No limit set." : `${limit} or more needs approval.`}</p>}
          <p className="faint" style={{ fontSize: 13 }}>Always held for a person, whatever the rules: anything the agent marks <code>reversible: false</code>, the first action of a new category, and replies that promise refunds, discounts, deadlines or compensation.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div><h3>🧾 Decision log</h3><span className="sub">Who approved what, when and why. Export it for audits.</span></div></div>
        {history.length === 0 ? <p className="faint">No decisions yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Action</th><th>Decision</th><th>Decided by</th><th>Why</th></tr></thead>
            <tbody>
              {history.map((a) => (
                <tr key={a.id}>
                  <td className="sub">{timeAgo(a.decided_at ?? a.created_at)}</td>
                  <td><b>{a.action}</b>{a.amount != null ? ` · ${a.amount} ${a.currency ?? ""}` : ""}<div className="sub">{a.summary}</div></td>
                  <td><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge></td>
                  <td>{a.status === "expired" ? "–" : a.decided_by}</td>
                  <td className="sub">{a.note ?? a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
