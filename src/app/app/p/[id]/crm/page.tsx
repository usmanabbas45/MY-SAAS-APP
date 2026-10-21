import { WatchPanel } from "../WatchPanel";
import { AutoRefresh, CopyButton, SubmitButton } from "@/components/client";
import { Badge, Empty, Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { FOLLOWUP_OPTIONS, REQUIRED_OPTIONS, type CrmSource } from "@/lib/crm/monitor";
import { PROVIDERS, providerById } from "@/lib/crm/providers";
import { all, get } from "@/lib/db";
import { projectAccess } from "@/lib/projects";
import { addCrmAction, checkCrmNowAction, deleteCrmAction, updateCrmAction } from "../actions";

export const metadata = { title: "CRM monitoring" };

const n = (sql: string, ...args: (string | number)[]) => get<{ n: number }>(sql, ...args)?.n ?? 0;
const DAY = 86400000;

export default async function CrmPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { project: p, role } = projectAccess(user.id, Number((await params).id));
  const flash = await searchParams;
  const canEdit = role !== "viewer";
  const sources = all<CrmSource>("SELECT * FROM crm_sources WHERE project_id = ? ORDER BY id", p.id);
  const pid = <input type="hidden" name="projectId" value={p.id} />;
  const since24 = new Date(Date.now() - DAY).toISOString();
  const api = `${(process.env.APP_URL || "https://proofmyai.com").replace(/\/+$/, "")}/api/v1/crm-records`;
  const pushExample = `curl -X POST ${api} \\
  -H "Authorization: Bearer ${p.api_key}" -H "Content-Type: application/json" \\
  -d '{"source": "Monday CRM", "records": [{"id": "123", "kind": "lead",
       "created_at": "2026-10-18T09:30:00Z", "updated_at": "2026-10-18T09:30:00Z",
       "email": "sara@shop.co", "phone": "+44 7700 900123", "name": "Sara K.", "owner": "Ali"}]}'`;

  return (
    <div>
      <AutoRefresh active ms={60000} />
      <Flash ok={flash.ok} error={flash.error} />
      <PageHeader title="CRM monitoring" subtitle="Your CRM is where forms, automations and AI agents write their results. Know when leads stop arriving, come in broken or duplicated, get changed in bulk, or nobody follows them up." />

      <div className="stack">
        {sources.length === 0 ? (
          <Empty icon="🗂️" title="No CRM connected yet">Connect HubSpot, Salesforce, Pipedrive, Zoho, GoHighLevel and more below. Read-only: ProofMyAI never changes your CRM and stores no names, emails or phone numbers.</Empty>
        ) : sources.map((s) => {
          const prov = providerById(s.provider);
          const total = n("SELECT COUNT(*) AS n FROM crm_records WHERE source_id = ?", s.id);
          const fresh = n("SELECT COUNT(*) AS n FROM crm_records WHERE source_id = ? AND created_at >= ?", s.id, since24);
          const newest = get<{ at: string | null }>("SELECT MAX(created_at) AS at FROM crm_records WHERE source_id = ?", s.id)?.at ?? null;
          const dupes = n("SELECT COALESCE(SUM(c - 1), 0) AS n FROM (SELECT COUNT(*) AS c FROM crm_records WHERE source_id = ? AND email_hash IS NOT NULL GROUP BY email_hash HAVING c > 1)", s.id);
          const noFollow = s.followup_hours ? n("SELECT COUNT(*) AS n FROM crm_records WHERE source_id = ? AND activity_known = 1 AND last_activity_at IS NULL AND created_at >= ? AND created_at <= ?", s.id, new Date(Date.now() - 7 * DAY).toISOString(), new Date(Date.now() - s.followup_hours * 3600000).toISOString()) : null;
          const open = n("SELECT COUNT(*) AS n FROM incidents WHERE project_id = ? AND resolved = 0 AND dedupe_key LIKE ?", p.id, `crm:${s.id}:%`);
          const required = s.required_fields.split(",").filter(Boolean);
          return (
            <div className="card up-card" key={s.id}>
              <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div className="row" style={{ gap: 10 }}>
                    <span className={`up-dot ${s.last_error ? "down" : open ? "failing" : "up"}`} aria-hidden />
                    <strong style={{ fontSize: 17 }}>{prov?.icon} {s.name}</strong>
                    <Badge>{prov?.label ?? s.provider}</Badge>
                    {open ? <Badge tone="bad">{open} problem{open === 1 ? "" : "s"}</Badge> : <Badge tone="ok">Healthy</Badge>}
                  </div>
                  <div className="faint" style={{ fontSize: 13 }}>{s.provider === "push" ? `Records sent by your automation · last ${timeAgo(s.last_polled_at)}` : `Checked ${timeAgo(s.last_polled_at)} · every 15 minutes · read-only`}</div>
                  {s.last_error ? <div style={{ color: "var(--bad)", fontSize: 13 }}>⚠ {s.last_error}</div> : null}
                </div>
                {canEdit ? (
                  <div className="row">
                    {s.provider !== "push" ? <form action={checkCrmNowAction}>{pid}<input type="hidden" name="crmId" value={s.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="Checking…">Check now</SubmitButton></form> : null}
                    <form action={deleteCrmAction}>{pid}<input type="hidden" name="crmId" value={s.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm={`Disconnect "${s.name}"? Its stored data is deleted.`}>Disconnect</SubmitButton></form>
                  </div>
                ) : null}
              </div>
              <div className="up-stats five">
                <div><span>Records watched</span><strong>{total.toLocaleString("en-GB")}</strong></div>
                <div><span>New (24h)</span><strong>{fresh}</strong></div>
                <div><span>Newest record</span><strong>{newest ? timeAgo(newest) : "–"}</strong></div>
                <div><span>Duplicates</span><strong style={dupes ? { color: "var(--warn)" } : undefined}>{dupes}</strong></div>
                <div><span>Not followed up</span><strong style={noFollow ? { color: "var(--bad)" } : undefined}>{noFollow == null ? "off" : noFollow}</strong></div>
              </div>
              {canEdit ? (
                <details>
                  <summary className="faint" style={{ cursor: "pointer" }}>Edit checks</summary>
                  <form action={updateCrmAction} style={{ marginTop: 10 }}>
                    {pid}<input type="hidden" name="crmId" value={s.id} />
                    <div className="grid grid-2">
                      <fieldset className="field" style={{ border: 0, padding: 0 }}>
                        <legend>Every new record must have</legend>
                        {REQUIRED_OPTIONS.map(([k, label]) => (
                          <label key={k} style={{ display: "inline-flex", gap: 6, marginRight: 14 }}><input type="checkbox" name="required" value={k} defaultChecked={required.includes(k)} /> {label}</label>
                        ))}
                      </fieldset>
                      <div className="field"><label htmlFor={`fu-${s.id}`}>Alert if a new lead isn&apos;t contacted within</label>
                        <select id={`fu-${s.id}`} name="followup_hours" defaultValue={String(s.followup_hours)}>
                          {FOLLOWUP_OPTIONS.map((h) => <option key={h} value={h}>{h === 0 ? "Off" : `${h} hour${h === 1 ? "" : "s"}`}</option>)}
                        </select>
                        <span className="hint">Uses the CRM&apos;s last-contacted date (HubSpot, Salesforce, Pipedrive, Zoho, GoHighLevel, Freshsales).</span>
                      </div>
                    </div>
                    <SubmitButton className="btn btn-sm" pendingText="Saving…">Save</SubmitButton>
                  </form>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>

      {canEdit ? (
        <div className="card" style={{ marginTop: 16 }} id="connect">
          <div className="card-head"><div><h3>➕ Connect a CRM</h3><span className="sub">Read-only. Pick yours and follow the steps (2–5 minutes).</span></div></div>
          <div className="stack">
            {PROVIDERS.map((prov) => (
              <details key={prov.id} className="card" style={{ boxShadow: "none" }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>{prov.icon} {prov.label}</summary>
                <ol className="faint" style={{ margin: "10px 0", paddingLeft: 20, lineHeight: 1.7 }}>{prov.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                {prov.fetch ? (
                  <form action={addCrmAction}>
                    {pid}<input type="hidden" name="provider" value={prov.id} />
                    <div className="grid grid-2">
                      <div className="field"><label htmlFor={`${prov.id}-name`}>Name <span className="hint">(optional)</span></label><input id={`${prov.id}-name`} name="name" type="text" maxLength={120} placeholder={prov.label} /></div>
                      {prov.fields.map((f) => (
                        <div className="field" key={f.key}><label htmlFor={`${prov.id}-${f.key}`}>{f.label}{f.optional ? <span className="hint"> (optional)</span> : null}</label>
                          <input id={`${prov.id}-${f.key}`} name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" required={!f.optional} placeholder={f.placeholder} /></div>
                      ))}
                    </div>
                    <SubmitButton pendingText="Connecting…">Connect {prov.label}</SubmitButton>
                  </form>
                ) : (
                  <div>
                    <pre style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)", padding: 12, borderRadius: 10, fontSize: 13 }}>{pushExample}</pre>
                    <CopyButton text={pushExample} />
                    <p className="faint" style={{ fontSize: 13 }}>Send up to 500 records per call. Use a different <code>source</code> name for each CRM. Optional: <code>last_activity_at</code> to enable follow-up alerts.</p>
                  </div>
                )}
              </details>
            ))}
          </div>
          <p className="faint" style={{ fontSize: 13, marginTop: 10 }}>
            Checked automatically: new leads stopped arriving (learned from your CRM&apos;s own rhythm), new records missing an email/phone or owner, duplicate records, hundreds of records changed at once, leads nobody contacted in time, and a lost connection. Only hashes and filled/empty flags are stored, never names, emails or phone numbers.
          </p>
        </div>
      ) : null}
      <WatchPanel projectId={p.id} module="crm" back={`/app/p/${p.id}/crm`} canEdit={role !== "viewer"} />
    </div>
  );
}
