import { WatchPanel } from "../WatchPanel";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { Empty, Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { projectAccess } from "@/lib/projects";
import { CHECK_EVERY_MIN, FRESH_OPTIONS, STALE_OPTIONS, TIME_ZONES, type SheetWatch } from "@/lib/sheets";
import { addSheetAction, checkSheetNowAction, deleteSheetAction, updateSheetAction } from "../actions";

export const metadata = { title: "Google Sheets" };

const STATUS = {
  ok: { label: "Healthy", cls: "up" },
  problem: { label: "Problem", cls: "failing" },
  error: { label: "Can't read", cls: "down" },
  pending: { label: "Checking…", cls: "pending" },
} as const;
const staleLabel = (h: number) => (h === 0 ? "Off (the sheet is edited by hand)" : h === 168 ? "7 days" : h >= 24 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);

function StaleSelect({ id, value }: { id: string; value: number }) {
  return (
    <select id={id} name="stale_hours" defaultValue={String(value)}>
      {STALE_OPTIONS.map((h) => <option key={h} value={h}>{staleLabel(h)}</option>)}
    </select>
  );
}

function FreshFields({ id, w }: { id: string; w?: SheetWatch }) {
  const tz = w?.fresh_tz || "UTC";
  return (
    <>
      <div className="field"><label htmlFor={`fc-${id}`}>Date column of each new record <span className="hint">(optional, e.g. Created at)</span></label><input id={`fc-${id}`} name="fresh_col" type="text" maxLength={100} defaultValue={w?.fresh_col ?? ""} placeholder="Created at" /></div>
      <div className="field"><label htmlFor={`fh-${id}`}>Newest record must be within</label>
        <select id={`fh-${id}`} name="fresh_hours" defaultValue={String(w?.fresh_hours || 24)}>
          {FRESH_OPTIONS.map((h) => <option key={h} value={h}>{staleLabel(h)}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor={`tz-${id}`}>Time zone of those dates</label>
        <select id={`tz-${id}`} name="fresh_tz" defaultValue={tz}>
          {(TIME_ZONES as readonly string[]).includes(tz) ? null : <option value={tz}>{tz}</option>}
          {TIME_ZONES.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
        </select>
      </div>
    </>
  );
}

const newestLabel = (iso: string, tz: string | null) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
};

export default async function SheetsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { project: p, role } = projectAccess(user.id, Number((await params).id));
  const flash = await searchParams;
  const sheets = all<SheetWatch>("SELECT * FROM sheet_watches WHERE project_id = ? ORDER BY CASE status WHEN 'error' THEN 0 WHEN 'problem' THEN 1 ELSE 2 END, id", p.id);
  const canEdit = role !== "viewer";
  const pid = <input type="hidden" name="projectId" value={p.id} />;
  const bad = sheets.filter((s) => s.status === "error" || s.status === "problem").length;

  return (
    <div>
      <AutoRefresh active ms={60000} />
      <Flash ok={flash.ok} error={flash.error} />
      <PageHeader title="Google Sheets" subtitle="Know when a sheet your automations fill stops updating or fills with broken data" />

      {sheets.length ? (
        <div className={`alert ${bad ? "alert-bad" : "alert-ok"}`} role="status">
          {bad ? `🔴 ${bad} of ${sheets.length} sheet${sheets.length === 1 ? " has" : "s have"} a problem. Alerts have been sent to your channels.`
            : sheets.every((s) => s.status === "ok") ? (sheets.length === 1 ? "🟢 Your sheet looks healthy." : `🟢 All ${sheets.length} sheets look healthy.`) : "⏳ Waiting for the first checks…"}
        </div>
      ) : null}

      <div className="stack">
        {sheets.length === 0 ? (
          <Empty icon="📗" title="No sheets yet">
            Add a Google Sheet that n8n, Make, Zapier or a form writes to. ProofMyAI reads it every {CHECK_EVERY_MIN} minutes and alerts you on WhatsApp, Slack or email when it stops updating, shows #REF! or #N/A errors, or a key column comes in empty.
          </Empty>
        ) : sheets.map((s) => {
          const st = STATUS[s.status];
          return (
            <div className="card up-card" key={s.id}>
              <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className={`up-dot ${st.cls}`} aria-hidden />
                    <strong style={{ fontSize: 17 }}>{s.name}</strong>
                    <span className={`badge up-badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="faint mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 560 }}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>
                  </div>
                  <div className="faint" style={{ fontSize: 13 }}>
                    Checked {timeAgo(s.last_checked_at)} · alert if no changes for {staleLabel(s.stale_hours).toLowerCase()}
                    {s.required_col ? ` · "${s.required_col}" must be filled` : ""}
                    {s.fresh_col ? ` · newest "${s.fresh_col}" within ${staleLabel(s.fresh_hours).toLowerCase()}` : ""}
                  </div>
                  {s.last_error ? <div style={{ color: "var(--bad)", fontSize: 13 }}>⚠ {s.last_error}</div> : null}
                </div>
                {canEdit ? (
                  <div className="row">
                    <form action={checkSheetNowAction}>{pid}<input type="hidden" name="sheetId" value={s.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="Checking…">Check now</SubmitButton></form>
                    <form action={deleteSheetAction}>{pid}<input type="hidden" name="sheetId" value={s.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm={`Stop watching "${s.name}"?`}>Remove</SubmitButton></form>
                  </div>
                ) : null}
              </div>
              <div className={`up-stats${s.fresh_col ? " five" : ""}`}>
                <div><span>Rows</span><strong>{s.row_count == null ? "–" : s.row_count.toLocaleString("en-GB")}</strong></div>
                <div><span>Last change</span><strong>{s.last_changed_at ? timeAgo(s.last_changed_at) : "–"}</strong></div>
                <div><span>Error cells</span><strong style={s.error_cells ? { color: "var(--bad)" } : undefined}>{s.error_cells}</strong></div>
                <div><span>{s.required_col ? `Empty “${s.required_col}”` : "Required column"}</span><strong style={s.blank_required ? { color: "var(--bad)" } : undefined}>{s.required_col ? s.blank_required : "–"}</strong></div>
                {s.fresh_col ? <div><span>Newest record</span><strong title={s.newest_at ?? undefined}>{s.newest_at ? newestLabel(s.newest_at, s.fresh_tz) : "–"}</strong>{s.newest_at ? <span>{timeAgo(s.newest_at)}</span> : null}</div> : null}
              </div>
              {canEdit ? (
                <details style={{ marginTop: 10 }}>
                  <summary className="faint" style={{ cursor: "pointer" }}>Edit checks</summary>
                  <form action={updateSheetAction} style={{ marginTop: 10 }}>
                    {pid}<input type="hidden" name="sheetId" value={s.id} />
                    <div className="grid grid-2">
                      <div className="field"><label htmlFor={`st-${s.id}`}>Alert if no changes for</label><StaleSelect id={`st-${s.id}`} value={s.stale_hours} /></div>
                      <div className="field"><label htmlFor={`rc-${s.id}`}>Column that must never be empty <span className="hint">(optional)</span></label><input id={`rc-${s.id}`} name="required_col" type="text" maxLength={100} defaultValue={s.required_col ?? ""} placeholder="Email" /></div>
                      <FreshFields id={String(s.id)} w={s} />
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
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><div><h3>➕ Watch a Google Sheet</h3><span className="sub">Read-only. ProofMyAI never changes your sheet.</span></div></div>
          <ol className="faint" style={{ margin: "0 0 14px", paddingLeft: 20, lineHeight: 1.7 }}>
            <li>Open the sheet in Google Sheets and go to the tab you want to watch.</li>
            <li>Click <strong>Share</strong>, set <strong>General access</strong> to <strong>Anyone with the link</strong> (Viewer), and click <strong>Copy link</strong>.</li>
            <li>Paste the link below. For private data, use <strong>File → Share → Publish to web</strong> for just that tab and paste the published link instead.</li>
          </ol>
          <form action={addSheetAction}>
            {pid}
            <div className="grid grid-2">
              <div className="field"><label htmlFor="sh-url">Google Sheet link</label><input id="sh-url" name="url" type="text" required placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" /></div>
              <div className="field"><label htmlFor="sh-name">Name <span className="hint">(optional)</span></label><input id="sh-name" name="name" type="text" maxLength={100} placeholder="New leads from n8n" /></div>
              <div className="field"><label htmlFor="sh-stale">Alert if no changes for</label><StaleSelect id="sh-stale" value={24} /></div>
              <div className="field"><label htmlFor="sh-col">Column that must never be empty <span className="hint">(optional, the heading in row 1)</span></label><input id="sh-col" name="required_col" type="text" maxLength={100} placeholder="Email" /></div>
              <FreshFields id="new" />
            </div>
            <p className="faint" style={{ fontSize: 13, margin: "0 0 12px" }}>
              The date column catches the quiet failure: the automation still runs and touches the sheet, but no new records arrive from the source. ProofMyAI reads the newest date in that column and alerts when it&apos;s too old.
            </p>
            <SubmitButton pendingText="Reading the sheet…">Start watching</SubmitButton>
          </form>
          <p className="faint" style={{ fontSize: 13, marginTop: 10 }}>
            Also checked automatically: #REF!, #N/A, #VALUE! and other error cells, and rows suddenly disappearing (sheet cleared or overwritten).
          </p>
        </div>
      ) : null}
      <WatchPanel projectId={p.id} module="incidents" back={`/app/p/${p.id}/sheets`} canEdit={role !== "viewer"} />
    </div>
  );
}
