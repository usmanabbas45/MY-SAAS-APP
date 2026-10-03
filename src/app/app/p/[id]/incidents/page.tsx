import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Badge, Empty, Flash, PageHeader, SeverityBadge, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { projectAccess } from "@/lib/projects";
import { resolveIncidentAction } from "../actions";

export const metadata = { title: "Incidents" };

export default async function IncidentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; show?: string }> }) {
  const user = await requireUser();
  const p = projectAccess(user.id, Number((await params).id)).project;
  const sp = await searchParams;
  const resolved = sp.show === "resolved";
  const rows = all<{ id: number; module: string; code: string; severity: string; title: string; detail: string; created_at: string }>(
    `SELECT id, module, code, severity, title, detail, created_at FROM incidents WHERE project_id = ? AND resolved = ?
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id DESC LIMIT 200`,
    p.id, resolved ? 1 : 0,
  );
  const base = `/app/p/${p.id}/incidents`;
  return (
    <div>
      <Flash ok={sp.ok} error={sp.error} />
      <PageHeader
        title="Incidents"
        subtitle="Everything that went wrong, most severe first. Alerts go to your Slack/Discord/email (see Settings)."
        actions={!resolved && rows.length > 0 ? (
          <form action={resolveIncidentAction}>
            <input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="incidentId" value="all" />
            <SubmitButton className="btn btn-ghost" confirm="Mark every open incident as resolved?">Resolve all</SubmitButton>
          </form>
        ) : null}
      />
      <div className="tabs">
        <Link className={`tab ${!resolved ? "active" : ""}`} href={base}>Open</Link>
        <Link className={`tab ${resolved ? "active" : ""}`} href={`${base}?show=resolved`}>Resolved</Link>
      </div>
      <div className="card">
        {rows.length === 0 ? <Empty icon={resolved ? "🗂️" : "🎉"} title={resolved ? "No resolved incidents" : "All clear"}>{resolved ? "" : "No open incidents. ProofMyAI keeps watching."}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Severity</th><th>Incident</th><th>Area</th><th>When</th>{resolved ? null : <th />}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><SeverityBadge severity={r.severity} /></td>
                    <td className="cell-text" style={{ maxWidth: 640 }}><strong>{r.title}</strong><div className="sub" style={{ whiteSpace: "pre-wrap" }}>{r.detail}</div></td>
                    <td><Badge>{r.module}</Badge></td>
                    <td className="sub">{timeAgo(r.created_at)}</td>
                    {resolved ? null : (
                      <td><form action={resolveIncidentAction}>
                        <input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="incidentId" value={r.id} />
                        <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Resolve</SubmitButton>
                      </form></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
