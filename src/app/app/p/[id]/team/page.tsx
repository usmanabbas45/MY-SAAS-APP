import { SubmitButton } from "@/components/client";
import { Badge, Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { billingState, usage } from "@/lib/billing";
import { get } from "@/lib/db";
import { projectAccess } from "@/lib/projects";
import { members, pendingInvites, ROLE_LABEL } from "@/lib/team";
import { inviteMemberAction, leaveProjectAction, removeMemberAction, revokeInviteAction, setMemberRoleAction } from "../actions";

export const metadata = { title: "Team" };

const ROLES = [
  ["viewer", "Viewer", "Sees results, reports and incidents. Can't change anything. API key hidden."],
  ["editor", "Editor", "Everything a viewer can, plus connect tools, run audits, add rules and tests."],
] as const;

export default async function TeamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { project: p, role } = projectAccess(user.id, Number((await params).id));
  const flash = await searchParams;
  const owner = get<{ email: string }>("SELECT email FROM users WHERE id = ?", p.user_id)?.email ?? "";
  const list = members(p.id);
  const invites = role === "owner" ? pendingInvites(p.id) : [];
  const pid = <input type="hidden" name="projectId" value={p.id} />;
  const plan = billingState(p.user_id).plan;
  const used = usage(p.user_id, plan).seats;

  return (
    <div>
      <Flash ok={flash.ok} error={flash.error} />
      <PageHeader title="Team" subtitle="Give teammates or clients access to this project" />

      <div className="card">
        <div className="card-head">
          <div><h3>👥 People with access</h3><span className="sub">{Number.isFinite(plan.seats) ? `${used} of ${plan.seats} team seats used on the ${plan.name} plan (across all your projects).` : "Unlimited team seats."}</span></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th><th>Role</th><th>Since</th><th /></tr></thead>
            <tbody>
              <tr><td>{owner}{p.user_id === user.id ? " (you)" : ""}</td><td><Badge tone="brand">Owner</Badge></td><td className="faint">-</td><td /></tr>
              {list.map((m) => (
                <tr key={m.user_id}>
                  <td>{m.email}{m.user_id === user.id ? " (you)" : ""}</td>
                  <td>
                    {role === "owner" ? (
                      <form action={setMemberRoleAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        {pid}<input type="hidden" name="userId" value={m.user_id} />
                        <select name="role" defaultValue={m.role} aria-label={`Role for ${m.email}`} style={{ width: "auto" }}>
                          <option value="viewer">Viewer</option><option value="editor">Editor</option>
                        </select>
                        <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Save</SubmitButton>
                      </form>
                    ) : <Badge>{ROLE_LABEL[m.role]}</Badge>}
                  </td>
                  <td className="faint">{timeAgo(m.created_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    {role === "owner" ? (
                      <form action={removeMemberAction}>{pid}<input type="hidden" name="userId" value={m.user_id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm={`Remove ${m.email} from this project?`}>Remove</SubmitButton></form>
                    ) : m.user_id === user.id ? (
                      <form action={leaveProjectAction}>{pid}<SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm="Leave this project? You'll lose access.">Leave</SubmitButton></form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {invites.map((i) => (
                <tr key={`i${i.id}`}>
                  <td>{i.email} <span className="faint">· invited {timeAgo(i.created_at)}</span></td>
                  <td><Badge tone="warn">Pending · {ROLE_LABEL[i.role]}</Badge></td>
                  <td className="faint">expires {new Date(`${i.expires_at.replace(" ", "T")}Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                  <td style={{ textAlign: "right" }}><form action={revokeInviteAction}>{pid}<input type="hidden" name="inviteId" value={i.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Cancel</SubmitButton></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {role === "owner" ? (
        <div className="card">
          <div className="card-head"><div><h3>✉️ Invite someone</h3><span className="sub">They get an email with a link. They log in or create a free account with that email to join. Billing stays on your account.</span></div></div>
          <form action={inviteMemberAction}>
            {pid}
            <div className="grid grid-2">
              <div className="field"><label htmlFor="inv-email">Email</label><input id="inv-email" name="email" type="email" required placeholder="teammate@company.com" autoComplete="off" /></div>
              <div className="field">
                <label htmlFor="inv-role">Role</label>
                <select id="inv-role" name="role" defaultValue="viewer">{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </div>
            </div>
            <ul className="sub" style={{ marginTop: 0 }}>{ROLES.map(([v, l, d]) => <li key={v}><strong>{l}:</strong> {d}</li>)}<li><strong>Owner (you):</strong> also settings, alerts, API key, team and billing.</li></ul>
            <SubmitButton pendingText="Sending…">Send invitation</SubmitButton>
          </form>
        </div>
      ) : (
        <div className="alert alert-info">You&apos;re {role === "editor" ? "an editor" : "a viewer"} on this project. Only the owner ({owner}) can invite people or change roles.</div>
      )}
    </div>
  );
}
