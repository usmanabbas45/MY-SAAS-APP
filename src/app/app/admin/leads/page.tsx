import Link from "next/link";
import { Flash } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { LEAD_STATUS_LABELS, LEAD_STATUSES, leadCounts, listLeads, type LeadStatus } from "@/lib/leads";
import { leadStatusAction } from "../actions";
import { AdminShell, ago } from "../ui";

export const metadata = { title: "Admin · Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; ok?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = LEAD_STATUSES.includes(sp.status as LeadStatus) ? (sp.status as LeadStatus) : undefined;
  const leads = listLeads(status);
  const counts = leadCounts();
  return (
    <AdminShell>
      <p className="sub"><Link href="/app/admin">← Admin dashboard</Link></p>
      <h1>📥 Leads</h1>
      <p className="sub">Free-audit requests from <Link href="/free-audit">/free-audit</Link>. Reply within 2 business days with the audit, then mark them. Hit &ldquo;Reply&rdquo; to answer from your email.</p>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="tabs">
        <Link href="/app/admin/leads" className={`tab ${!status ? "active" : ""}`}>All ({counts.all})</Link>
        {LEAD_STATUSES.map((s) => <Link key={s} href={`/app/admin/leads?status=${s}`} className={`tab ${status === s ? "active" : ""}`}>{LEAD_STATUS_LABELS[s]} ({counts[s]})</Link>)}
      </div>
      {leads.length === 0 ? (
        <div className="card"><p className="sub" style={{ margin: 0 }}>No leads yet. Share <code>/free-audit?utm_source=linkedin</code> in your outreach messages.</p></div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Website</th><th>Uses</th><th>Came from</th><th>Status</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td className="faint" style={{ whiteSpace: "nowrap" }}>{ago(l.created_at)}</td>
                  <td>
                    <strong>{l.name || l.email}</strong><div className="faint"><a href={`mailto:${l.email}?subject=${encodeURIComponent("Your free ProofMyAI chatbot audit")}`}>{l.email}</a></div>
                    {l.message ? <div className="sub" style={{ marginTop: 4, maxWidth: 320 }}>&ldquo;{l.message}&rdquo;</div> : null}
                  </td>
                  <td>{l.website ? <a href={l.website} target="_blank" rel="noopener nofollow">{l.website.replace(/^https?:\/\//, "")}</a> : "–"}</td>
                  <td>{l.platform ?? "–"}</td>
                  <td>{l.channel ?? "–"}{l.campaign ? <div className="faint">{l.campaign}</div> : null}</td>
                  <td>
                    <form action={leadStatusAction} className="row" style={{ gap: 6 }}>
                      <input type="hidden" name="id" value={l.id} />
                      <select name="status" defaultValue={l.status} aria-label="Lead status">
                        {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
                      </select>
                      <button className="btn btn-ghost btn-sm">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
