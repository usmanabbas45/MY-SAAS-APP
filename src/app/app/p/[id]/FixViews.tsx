import { CopyButton, SubmitButton } from "@/components/client";
import { timeAgo } from "@/components/ui";
import { fixNotes, type AiFix } from "@/lib/fixes";
import { applyFixAction, safePromptAction } from "./actions";

/** A generated help-article fix under its fix-list item. */
export function ArticleFix({ fix, projectId, auditId, canEdit }: { fix: AiFix; projectId: number; auditId: number; canEdit: boolean }) {
  return (
    <div className="fix-result" id={`fix-${fix.id}`}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <strong>✨ Corrected article: {fix.title}</strong>
        <span className="faint" style={{ fontSize: 12 }}>written {timeAgo(fix.created_at)}</span>
      </div>
      <ul className="fix-notes">{fixNotes(fix).map((n, i) => <li key={i}>{n}</li>)}</ul>
      <pre className="fix-text">{fix.output}</pre>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <CopyButton text={fix.output} label="Copy article" />
        {canEdit ? (
          fix.applied_at ? <span className="badge badge-ok">✓ Saved to knowledge base</span> : (
            <form action={applyFixAction}>
              <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="auditId" value={auditId} /><input type="hidden" name="fixId" value={fix.id} />
              <SubmitButton className="btn btn-sm" pendingText="Saving…">💾 Save to knowledge base</SubmitButton>
            </form>
          )
        ) : null}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>Check anything marked [ADD: …] and fill it in. Then paste the article into your chatbot&apos;s knowledge base (Intercom, Chatbase, Tidio, your own bot…).</p>
    </div>
  );
}

/** Card that writes / shows a hardened system prompt for the customer's own bot. */
export function SafePromptCard({ fix, projectId, back, canEdit, aiOff }: { fix: AiFix | undefined; projectId: number; back: string; canEdit: boolean; aiOff: string | null }) {
  return (
    <div className="card" id="safe-prompt">
      <div className="card-head">
        <div>
          <h3>🛡️ Safe system prompt for your bot</h3>
          <span className="sub">A ready-to-paste system prompt built from your help articles, your rules and every problem ProofMyAI found: prompt-injection protection, no made-up prices, human hand-over, the customer&apos;s language.</span>
        </div>
        {canEdit && !aiOff ? (
          <form action={safePromptAction}>
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} />
            <SubmitButton className={`btn btn-sm ${fix ? "btn-ghost" : ""}`} pendingText="Writing… (about 30 s)">{fix ? "↻ Write again" : "✨ Write my safe prompt"}</SubmitButton>
          </form>
        ) : null}
      </div>
      {aiOff && !fix ? <p className="sub" style={{ margin: 0 }}>{aiOff}</p> : null}
      {fix ? (
        <div className="fix-result" style={{ marginTop: 0 }}>
          <ul className="fix-notes">{fixNotes(fix).map((n, i) => <li key={i}>{n}</li>)}</ul>
          <pre className="fix-text">{fix.output}</pre>
          <div className="row" style={{ gap: 8 }}><CopyButton text={fix.output} label="Copy prompt" /><span className="faint" style={{ fontSize: 12 }}>written {timeAgo(fix.created_at)}</span></div>
          <p className="hint" style={{ marginTop: 8 }}>Paste it into your bot&apos;s “system prompt”, “instructions” or “persona” setting, then run your nightly tests to confirm it helped.</p>
        </div>
      ) : null}
    </div>
  );
}
