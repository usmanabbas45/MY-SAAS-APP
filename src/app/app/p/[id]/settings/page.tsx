import { CopyButton, SubmitButton } from "@/components/client";
import { Badge, Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { FEATURE_NAMES } from "@/lib/judge/features";
import { llmAvailable } from "@/lib/judge/llm";
import { MIN_TRAINING_LABELS } from "@/lib/ml/risk";
import { ownedProject } from "@/lib/projects";
import { deleteProjectAction, regenerateKeyAction, retrainAction, testAlertAction, updateSettingsAction } from "../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const flash = await searchParams;
  const model = get<{ n_samples: number; val_accuracy: number; trained_at: string }>("SELECT n_samples, val_accuracy, trained_at FROM risk_models WHERE project_id = ?", p.id);
  const labels = get<{ n: number; bad: number | null }>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN COALESCE(i.corrected_verdict, i.verdict) <> 'correct' THEN 1 ELSE 0 END) AS bad
       FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND i.feedback IS NOT NULL`, p.id,
  );
  const pid = <input type="hidden" name="projectId" value={p.id} />;

  return (
    <div>
      <Flash {...flash} />
      <PageHeader title="Settings" subtitle={`Project: ${p.name}`} />
      <div className="grid grid-2">
        <form action={updateSettingsAction} className="card">
          {pid}
          <h3>Project & alerts</h3>
          <div className="field"><label htmlFor="name">Project name</label><input id="name" name="name" type="text" defaultValue={p.name} maxLength={100} /></div>
          <div className="field">
            <label htmlFor="wh">Alert webhook <span className="hint">(Slack, Discord, Teams or Google Chat incoming-webhook URL)</span></label>
            <input id="wh" name="alert_webhook" type="url" defaultValue={p.alert_webhook ?? ""} placeholder="https://hooks.slack.com/services/…" />
          </div>
          <div className="field">
            <label htmlFor="em">Alert email {process.env.RESEND_API_KEY ? null : <span className="hint">(needs RESEND_API_KEY on the server)</span>}</label>
            <input id="em" name="alert_email" type="email" defaultValue={p.alert_email ?? ""} placeholder="you@company.com" />
          </div>
          <h3 style={{ marginTop: 18 }}>AI agent limits</h3>
          <div className="grid grid-3">
            <div className="field"><label htmlFor="b">Budget / run ($)</label><input id="b" name="agent_cost_budget_usd" type="number" step="any" min="0.0001" defaultValue={p.agent_cost_budget_usd} /></div>
            <div className="field"><label htmlFor="s">Max steps</label><input id="s" name="agent_max_steps" type="number" min="1" defaultValue={p.agent_max_steps} /></div>
            <div className="field"><label htmlFor="t">Max seconds</label><input id="t" name="agent_max_seconds" type="number" min="1" defaultValue={Math.round(p.agent_max_ms / 1000)} /></div>
          </div>
          <label className="check"><input type="checkbox" name="agent_ai_review" defaultChecked={Boolean(p.agent_ai_review)} /> AI review of agent outputs (goal achieved? grounded in tool results?)</label>
          <div className="row" style={{ marginTop: 16 }}><SubmitButton pendingText="Saving…">Save settings</SubmitButton></div>
        </form>

        <div className="stack">
          <div className="card">
            <h3>Test your alerts</h3>
            <p className="sub">Sends a sample incident to your webhook and email.</p>
            <form action={testAlertAction}>{pid}<SubmitButton className="btn btn-ghost" pendingText="Sending…">Send test alert</SubmitButton></form>
          </div>
          <div className="card">
            <h3>API key</h3>
            <p className="sub">Used by your agents, n8n and Make to send runs. Keep it secret.</p>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <code style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.api_key.slice(0, 14)}••••••••••••</code>
              <CopyButton text={p.api_key} />
            </div>
            <form action={regenerateKeyAction} style={{ marginTop: 12 }}>{pid}<SubmitButton className="btn btn-ghost btn-sm" confirm="The current key will stop working immediately. Continue?">Regenerate key</SubmitButton></form>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><h3>🧠 Your neural risk model</h3><span className="sub">A deep neural network (2 hidden layers, Adam optimiser, early stopping) trained only on this project&apos;s reviewed answers. It learns which answers <em>your</em> business considers wrong and ranks them first.</span></div>
          <Badge tone={model ? "ok" : "muted"}>{model ? "Trained" : "Not trained yet"}</Badge>
        </div>
        <div className="grid grid-4">
          <div className="stat"><span className="stat-label">Reviewed answers</span><span className="stat-value">{labels?.n ?? 0}</span><span className="stat-foot">{MIN_TRAINING_LABELS} needed to train</span></div>
          <div className="stat"><span className="stat-label">Marked as bad</span><span className="stat-value">{labels?.bad ?? 0}</span><span className="stat-foot">needs good and bad examples</span></div>
          <div className="stat"><span className="stat-label">Validation accuracy</span><span className="stat-value">{model ? `${Math.round(model.val_accuracy * 100)}%` : "–"}</span><span className="stat-foot">on held-out reviews</span></div>
          <div className="stat"><span className="stat-label">Last trained</span><span className="stat-value" style={{ fontSize: 20 }}>{model ? timeAgo(model.trained_at) : "never"}</span><span className="stat-foot">{model ? `${model.n_samples} samples` : ""}</span></div>
        </div>
        <div className="progress" style={{ margin: "14px 0" }}><span style={{ width: `${Math.min(100, ((labels?.n ?? 0) / MIN_TRAINING_LABELS) * 100)}%` }} /></div>
        <div className="row">
          <form action={retrainAction}>{pid}<SubmitButton pendingText="Training…">{model ? "Retrain model" : "Train model"}</SubmitButton></form>
          <a className="btn btn-ghost" href={`/app/p/${p.id}/export`}>⬇ Export training data (JSONL)</a>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Inputs: {FEATURE_NAMES.length} signals ({FEATURE_NAMES.slice(0, 5).join(", ")}, …). The export is ready for fine-tuning a larger model once you have thousands of reviews.
          Judge: {llmAvailable() ? `Claude (${process.env.JUDGE_MODEL || "claude-opus-5"})` : "basic mode - add ANTHROPIC_API_KEY for the AI judge"}.
        </p>
      </div>

      <form action={deleteProjectAction} className="card" style={{ borderColor: "var(--bad)" }}>
        {pid}
        <h3 style={{ color: "var(--bad)" }}>Delete project</h3>
        <p className="sub">Deletes all audits, tests, runs and incidents for this project. This cannot be undone.</p>
        <div className="row">
          <input name="confirm" type="text" placeholder={`Type "${p.name}" to confirm`} style={{ maxWidth: 320 }} />
          <SubmitButton className="btn btn-danger" pendingText="Deleting…">Delete project</SubmitButton>
        </div>
      </form>
    </div>
  );
}
