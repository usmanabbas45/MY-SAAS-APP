import { SubmitButton } from "@/components/client";
import { Badge, timeAgo } from "@/components/ui";
import { projectWatches, SOURCES, type WatchModule } from "@/lib/watches";
import { addWatchAction, deleteWatchAction, toggleWatchAction } from "./actions";

/**
 * "Watch for…" box shown on every feature page: the customer writes in plain English what ProofMyAI should
 * watch and when to notify them; it shows how each request was understood and when it last fired.
 */
export function WatchPanel({ projectId, module, back, canEdit }: { projectId: number; module: WatchModule; back: string; canEdit: boolean }) {
  const src = SOURCES[module];
  const watches = projectWatches(projectId, module);
  const hidden = (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="module" value={module} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  return (
    <div className="card watch-panel">
      <div className="card-head">
        <div>
          <h3>🔔 Watch for anything, in your own words</h3>
          <span className="sub">Tell ProofMyAI what to watch in {src.label} and when to notify you. Alerts go to your alert channels (WhatsApp, Slack, email…).</span>
        </div>
        <Badge tone={watches.length ? "brand" : "muted"}>{watches.length} watch{watches.length === 1 ? "" : "es"}</Badge>
      </div>

      {watches.map((w) => (
        <div key={w.id} className="watch-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>“{w.prompt}”</strong>
            <div className="sub">🧠 Understood as: {w.spec.summary}</div>
            <div className="sub">
              {w.enabled ? "Watching" : "Paused"}
              {w.last_fired_at ? ` · last alert ${timeAgo(w.last_fired_at)} · ${w.fired_count} alert${w.fired_count === 1 ? "" : "s"} so far` : " · no alerts yet"}
            </div>
          </div>
          {canEdit ? (
            <div className="row" style={{ gap: 6 }}>
              <form action={toggleWatchAction}>{hidden}<input type="hidden" name="watchId" value={w.id} /><button className="btn btn-ghost btn-sm">{w.enabled ? "Pause" : "Resume"}</button></form>
              <form action={deleteWatchAction}>{hidden}<input type="hidden" name="watchId" value={w.id} /><button className="btn btn-ghost btn-sm" aria-label={`Delete watch ${w.prompt}`}>✕</button></form>
            </div>
          ) : null}
        </div>
      ))}

      {canEdit ? (
        <form action={addWatchAction} style={{ marginTop: 10 }}>
          {hidden}
          <label htmlFor={`watch-${module}`}>What should ProofMyAI watch, and when should it tell you?</label>
          <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input id={`watch-${module}`} name="prompt" type="text" required minLength={8} maxLength={500} placeholder={src.examples[0]} style={{ flex: "1 1 320px" }} />
            <SubmitButton pendingText="Understanding…">Start watching</SubmitButton>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>Examples: {src.examples.map((e) => `“${e}”`).join(" · ")}. ProofMyAI shows how it understood your request and how often it would have alerted in the last 7 days.</p>
        </form>
      ) : null}
    </div>
  );
}
