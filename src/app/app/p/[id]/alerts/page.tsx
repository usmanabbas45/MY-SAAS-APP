import { SubmitButton } from "@/components/client";
import { Badge, Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { CHANNEL_TYPES, channelsFor, managedWhatsAppProvider, type Channel } from "@/lib/notify";
import { projectAccess } from "@/lib/projects";
import { projectRole } from "@/lib/team";
import { addChannelAction, deleteChannelAction, testAlertAction, toggleChannelAction, updateChannelAction, verifyChannelAction } from "../actions";
import { AlertPicker, RuleFields } from "./AlertPicker";

export const metadata = { title: "Alerts" };

const ICON: Record<string, string> = { email: "✉️", wa: "🟢", slack: "💬", teams: "🟣", discord: "🎮", google_chat: "🟩", telegram: "✈️", sms: "📱", whatsapp: "📲", webhook: "🔗" };
const SEV: Record<string, string> = { high: "Only urgent problems", medium: "Important problems", low: "Everything" };

function shownTarget(c: Channel): string {
  if (c.type === "email" || c.type === "telegram") return c.target;
  if (c.type === "sms" || c.type === "whatsapp" || c.type === "wa") return `${c.target.slice(0, 4)}•••${c.target.slice(-3)}`;
  return `${c.target.replace(/^https:\/\//, "").slice(0, 34)}…`;
}

export default async function AlertsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; verify?: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const sp = await searchParams;
  const role = projectRole(user.id, id);
  if (role && role !== "owner") {
    return (
      <div>
        <PageHeader title="Alerts" />
        <div className="alert alert-info">Only the project owner chooses where alerts go. You have {role} access. Ask the owner to add your email or WhatsApp as an alert channel.</div>
      </div>
    );
  }
  const p = projectAccess(user.id, id, "owner").project;
  const channels = channelsFor(p.id);
  const pid = <input type="hidden" name="projectId" value={p.id} />;
  const active = channels.filter((c) => c.enabled !== 0 && !c.verify_hash).length;

  return (
    <div>
      <Flash ok={sp.ok} error={sp.error} />
      <PageHeader
        title="🔔 Alerts"
        subtitle="Choose how you hear about problems: wrong chatbot answers, failed workflows, agent errors and downtime."
        actions={active ? <form action={testAlertAction}>{pid}<SubmitButton className="btn btn-ghost" pendingText="Sending…">Send test to all</SubmitButton></form> : undefined}
      />

      {channels.length === 0 ? (
        <div className="alert alert-warn">⚠️ No alert channels yet, so nobody is told when something breaks. Pick one below.</div>
      ) : null}

      {channels.length ? (
        <div className="alert-list">
          {channels.map((c) => {
            const pending = Boolean(c.verify_hash);
            const paused = c.enabled === 0;
            return (
              <div key={c.id} id={`ch-${c.id}`} className={`card alert-ch ${paused ? "paused" : ""}`}>
                <div className="alert-ch-head">
                  <span className="alert-tile-icon" aria-hidden>{ICON[c.type] ?? "🔔"}</span>
                  <div className="alert-ch-main">
                    <strong>{c.label || (CHANNEL_TYPES[c.type]?.label ?? c.type)}</strong>
                    <div className="faint mono">{c.label ? `${CHANNEL_TYPES[c.type]?.label} · ` : ""}{shownTarget(c)}</div>
                    <div className="sub" style={{ margin: "4px 0 0" }}>
                      {SEV[c.min_severity]} · {c.modules ? c.modules.split(",").join(", ") : "everything"}{c.notify_resolved ? " · + when fixed" : ""}
                    </div>
                  </div>
                  <div className="alert-ch-status">
                    {pending ? <Badge tone="warn">Waiting for code</Badge> : paused ? <Badge tone="muted">Paused</Badge>
                      : c.last_status ? (c.last_status === "ok" ? <Badge tone="ok">✓ Delivered {timeAgo(c.last_sent_at!)}</Badge> : <span style={{ color: "var(--bad)" }} title={c.last_status}>⚠ {c.last_status.slice(0, 70)}</span>)
                      : <Badge tone="info">Active</Badge>}
                  </div>
                </div>

                {pending ? (
                  <form action={verifyChannelAction} className="alert-verify">
                    {pid}<input type="hidden" name="channelId" value={c.id} />
                    <label htmlFor={`code-${c.id}`}>Enter the 6-digit code we sent to your WhatsApp</label>
                    <div className="row">
                      <input id={`code-${c.id}`} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" autoFocus={sp.verify === String(c.id)} style={{ maxWidth: 160 }} />
                      <SubmitButton pendingText="Checking…">Turn on</SubmitButton>
                      <button name="resend" value="1" className="btn btn-ghost btn-sm">Send a new code</button>
                    </div>
                  </form>
                ) : (
                  <div className="row alert-ch-actions">
                    <form action={testAlertAction}>{pid}<input type="hidden" name="channelId" value={c.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Send test</SubmitButton></form>
                    <form action={toggleChannelAction}>{pid}<input type="hidden" name="channelId" value={c.id} /><input type="hidden" name="enabled" value={paused ? "1" : "0"} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">{paused ? "▶ Resume" : "⏸ Pause"}</SubmitButton></form>
                    <details className="alert-edit">
                      <summary className="btn btn-ghost btn-sm">✏️ Edit rules</summary>
                      <form action={updateChannelAction}>
                        {pid}<input type="hidden" name="channelId" value={c.id} />
                        <RuleFields severity={c.min_severity} modules={c.modules} resolved={Boolean(c.notify_resolved)} label={c.label ?? ""} />
                        <SubmitButton className="btn btn-sm" pendingText="Saving…">Save rules</SubmitButton>
                      </form>
                    </details>
                    <form action={deleteChannelAction}>{pid}<input type="hidden" name="channelId" value={c.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm="Remove this alert channel?">Remove</SubmitButton></form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>+ Add a way to get alerts</h3>
        <AlertPicker action={addChannelAction} projectId={p.id} managedWhatsApp={Boolean(managedWhatsAppProvider())} ownerEmail={user.email} />
      </div>
      <p className="faint" style={{ marginTop: 12 }}>Repeated problems are grouped into one alert, so you won&apos;t be spammed. Every alert links to the incident with the full details.</p>
    </div>
  );
}
