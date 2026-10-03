import { AutoRefresh, SubmitButton } from "@/components/client";
import { Empty, Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { billingState } from "@/lib/billing";
import { all } from "@/lib/db";
import { projectAccess } from "@/lib/projects";
import { INTERVALS, monitorStats, type Monitor } from "@/lib/uptime";
import { addMonitorAction, checkMonitorNowAction, deleteMonitorAction } from "../actions";

export const metadata = { title: "Uptime" };

const pct = (v: number | null) => (v == null ? "–" : `${v.toFixed(v === 100 ? 0 : 2)}%`);
const STATUS = { up: { label: "Up", cls: "up" }, down: { label: "Down", cls: "down" }, pending: { label: "Checking…", cls: "pending" }, failing: { label: "Failing", cls: "failing" } } as const;
const stateOf = (m: Monitor): keyof typeof STATUS => (m.status !== "down" && m.fails > 0 ? "failing" : m.status);

export default async function UptimePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const p = projectAccess(user.id, Number((await params).id)).project;
  const flash = await searchParams;
  const monitors = all<Monitor>("SELECT * FROM uptime_monitors WHERE project_id = ? ORDER BY CASE status WHEN 'down' THEN 0 ELSE 1 END, id", p.id);
  const free = billingState(p.user_id).plan.id === "free";
  const pid = <input type="hidden" name="projectId" value={p.id} />;
  const down = monitors.filter((m) => m.status === "down").length;
  const failing = monitors.filter((m) => stateOf(m) === "failing").length;
  const up = monitors.filter((m) => stateOf(m) === "up").length;

  return (
    <div>
      <AutoRefresh active ms={30000} />
      <Flash ok={flash.ok} error={flash.error} />
      <PageHeader title="Uptime & speed" subtitle="Know the moment your chatbot, website or API stops responding, before customers do" />

      {monitors.length ? (
        <div className={`alert ${down ? "alert-bad" : failing ? "alert-warn" : "alert-ok"}`} role="status">
          {down ? `🔴 ${down} of ${monitors.length} monitor${monitors.length === 1 ? " is" : "s are"} down. Alerts have been sent to your channels.`
            : failing ? `🟠 ${failing} monitor${failing === 1 ? " failed its" : "s failed their"} last check. You'll get an alert if the next check fails too.`
            : up === monitors.length ? (monitors.length === 1 ? "🟢 Your monitor is up." : `🟢 All ${monitors.length} monitors are up.`) : "⏳ Waiting for the first checks…"}
        </div>
      ) : null}

      <div className="stack">
        {monitors.length === 0 ? (
          <Empty icon="🟢" title="No monitors yet">Add your chatbot&apos;s URL, your website or an API endpoint below. ProofMyAI checks it every few minutes and alerts you on Slack, email or WhatsApp if it goes down or gets slow.</Empty>
        ) : monitors.map((m) => {
          const st = monitorStats(m.id);
          const s = STATUS[stateOf(m)];
          return (
            <div className="card up-card" key={m.id}>
              <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className={`up-dot ${s.cls}`} aria-hidden />
                    <strong style={{ fontSize: 17 }}>{m.name}</strong>
                    <span className={`badge up-badge ${s.cls}`}>{s.label}</span>
                  </div>
                  <div className="faint mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 560 }}>{m.url}</div>
                  <div className="faint" style={{ fontSize: 13 }}>
                    Every {m.interval_min} min{m.keyword ? ` · must contain “${m.keyword}”` : ""} · checked {timeAgo(m.last_checked_at)}
                    {m.status === "down" && m.down_since ? ` · down since ${timeAgo(m.down_since)}` : ""}
                  </div>
                  {m.last_error ? <div style={{ color: "var(--bad)", fontSize: 13 }}>⚠ {m.last_error}</div> : null}
                </div>
                <div className="row">
                  <form action={checkMonitorNowAction}>{pid}<input type="hidden" name="monitorId" value={m.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="Checking…">Check now</SubmitButton></form>
                  <form action={deleteMonitorAction}>{pid}<input type="hidden" name="monitorId" value={m.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm={`Remove "${m.name}"?`}>Remove</SubmitButton></form>
                </div>
              </div>
              <div className="up-stats">
                <div><span>Uptime 24h</span><strong>{pct(st.uptime24h)}</strong></div>
                <div><span>7 days</span><strong>{pct(st.uptime7d)}</strong></div>
                <div><span>30 days</span><strong>{pct(st.uptime30d)}</strong></div>
                <div><span>Avg response</span><strong>{st.avgMs == null ? "–" : `${st.avgMs} ms`}</strong></div>
              </div>
              <div className="up-bars" role="img" aria-label={`Last ${st.recent.length} checks`}>
                {st.recent.map((c, i) => <span key={i} className={c.ok ? "ok" : "bad"} title={`${new Date(c.at).toLocaleString("en-GB")} · ${c.ok ? `up, ${c.ms} ms` : "down"}`} />)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div><h3>➕ Add a monitor</h3><span className="sub">Your chatbot page, widget script, API health URL or website. Alerts after 2 failed checks in a row, and again when it&apos;s back.</span></div></div>
        <form action={addMonitorAction}>
          {pid}
          <div className="grid grid-2">
            <div className="field"><label htmlFor="up-url">URL</label><input id="up-url" name="url" type="text" required placeholder="https://yourshop.com or https://api.yourbot.com/health" /></div>
            <div className="field"><label htmlFor="up-name">Name <span className="hint">(optional)</span></label><input id="up-name" name="name" type="text" maxLength={100} placeholder="Website chatbot" /></div>
            <div className="field"><label htmlFor="up-kw">Must contain text <span className="hint">(optional, e.g. a word from your chat widget)</span></label><input id="up-kw" name="keyword" type="text" maxLength={200} placeholder="chat-widget" /></div>
            <div className="field">
              <label htmlFor="up-int">Check every</label>
              <select id="up-int" name="interval_min" defaultValue="5">
                {INTERVALS.map((n) => <option key={n} value={n} disabled={n === 1 && free}>{n === 60 ? "1 hour" : `${n} minute${n === 1 ? "" : "s"}`}{n === 1 && free ? " (paid plans)" : ""}</option>)}
              </select>
            </div>
          </div>
          <SubmitButton pendingText="Checking…">Add monitor</SubmitButton>
        </form>
      </div>
    </div>
  );
}
