import { unsubHeaders, unsubUrl } from "./unsubscribe";
import { all, get, run } from "./db";
import { sendMail } from "./email";
import { digestEmail, type DigestData } from "./emails";
import { projectHealth } from "./health";
import { trustReport } from "./trust";

/** The newer modules, only for projects that use them. */
export function digestExtras(projectId: number): [string, string][] {
  const n = (sql: string) => get<{ n: number }>(sql, projectId)?.n ?? 0;
  const out: [string, string][] = [];
  const t = trustReport(projectId, 30);
  if (t.score != null) out.push(["🛡️ AI trust score", `${t.score}/100 · ${t.autopilotShare ?? 0}% of decisions can be made alone`]);
  const decided = n("SELECT COUNT(*) AS n FROM approvals WHERE project_id = ? AND created_at >= datetime('now', '-7 days')");
  const waiting = n("SELECT COUNT(*) AS n FROM approvals WHERE project_id = ? AND status = 'pending'");
  if (decided || waiting) out.push(["✋ Agent approvals", `${decided} this week · ${waiting} waiting for you`]);
  const crm = n("SELECT COUNT(*) AS n FROM crm_sources WHERE project_id = ?");
  if (crm) {
    const fresh = n("SELECT COUNT(*) AS n FROM crm_records r JOIN crm_sources s ON s.id = r.source_id WHERE s.project_id = ? AND r.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')");
    const bad = n("SELECT COUNT(*) AS n FROM incidents WHERE project_id = ? AND resolved = 0 AND code LIKE 'CRM_%'");
    out.push(["🗂️ CRM", `${fresh} new records this week · ${bad ? `${bad} open problem${bad === 1 ? "" : "s"}` : "healthy"}`]);
  }
  const sheets = n("SELECT COUNT(*) AS n FROM sheet_watches WHERE project_id = ?");
  const beats = n("SELECT COUNT(*) AS n FROM job_heartbeats WHERE project_id = ?");
  if (sheets || beats) {
    const bad = n("SELECT COUNT(*) AS n FROM sheet_watches WHERE project_id = ? AND status IN ('problem', 'error')") + n("SELECT COUNT(*) AS n FROM job_heartbeats WHERE project_id = ? AND status IN ('late', 'failed')");
    out.push(["📗 Sheets & 💓 scheduled jobs", `${sheets} sheet${sheets === 1 ? "" : "s"} · ${beats} job${beats === 1 ? "" : "s"} · ${bad ? `${bad} with problems` : "all healthy"}`]);
  }
  return out;
}

interface DigestProject { id: number; name: string; alert_email: string }

export function digestData(projectId: number, name: string): DigestData {
  const h = projectHealth(projectId, 7);
  const since = "datetime('now', '-7 days')";
  const n = (sql: string) => get<{ n: number }>(sql, projectId)?.n ?? 0;
  return {
    projectId, projectName: name, score: h.overall,
    modules: [
      ["💬 Chatbot accuracy", h.modules.chatbot.score, h.modules.chatbot.detail],
      ["🧪 Chatbot tests", h.modules.tests.score, h.modules.tests.detail],
      ["🤖 AI agents", h.modules.agents.score, h.modules.agents.detail],
      ["⚙️ n8n & Make", h.modules.workflows.score, h.modules.workflows.detail],
    ],
    answers: n(`SELECT COUNT(*) AS n FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND i.created_at >= ${since}`),
    bad: n(`SELECT COUNT(*) AS n FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND i.created_at >= ${since} AND COALESCE(i.corrected_verdict, i.verdict) <> 'correct'`),
    newIncidents: n(`SELECT COUNT(*) AS n FROM incidents WHERE project_id = ? AND created_at >= ${since}`),
    openIncidents: h.openIncidents,
    top: all<{ title: string }>("SELECT title FROM incidents WHERE project_id = ? AND resolved = 0 ORDER BY CASE severity WHEN 'high' THEN 0 ELSE 1 END, id DESC LIMIT 3", projectId).map((t) => t.title),
    extras: digestExtras(projectId),
  };
}

export function digestText(projectId: number, name: string, appUrl: string): string {
  const h = projectHealth(projectId, 7);
  const since = "datetime('now', '-7 days')";
  const n = (sql: string) => get<{ n: number }>(sql, projectId)?.n ?? 0;
  const newIncidents = n(`SELECT COUNT(*) AS n FROM incidents WHERE project_id = ? AND created_at >= ${since}`);
  const answers = n(`SELECT COUNT(*) AS n FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND i.created_at >= ${since}`);
  const bad = n(`SELECT COUNT(*) AS n FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND i.created_at >= ${since} AND COALESCE(i.corrected_verdict, i.verdict) <> 'correct'`);
  const top = all<{ title: string }>("SELECT title FROM incidents WHERE project_id = ? AND resolved = 0 ORDER BY CASE severity WHEN 'high' THEN 0 ELSE 1 END, id DESC LIMIT 3", projectId);
  const line = (label: string, m: { score: number | null; detail: string }) => `  • ${label}: ${m.score == null ? "not set up" : `${m.score}%`} (${m.detail})`;
  return [
    `Your weekly ProofMyAI summary for "${name}"`,
    "",
    `AI Health score: ${h.overall ?? "–"}/100`,
    line("Chatbot accuracy", h.modules.chatbot),
    line("Chatbot tests", h.modules.tests),
    line("AI agents", h.modules.agents),
    line("n8n & Make", h.modules.workflows),
    "",
    `Chatbot answers checked this week: ${answers} (${bad} with problems)`,
    `New incidents this week: ${newIncidents} · still open: ${h.openIncidents}`,
    ...digestExtras(projectId).map(([k, v]) => `${k}: ${v}`),
    ...(top.length ? ["", "Needs attention:", ...top.map((t) => `  • ${t.title}`)] : []),
    "",
    `Open your dashboard: ${appUrl}/app/p/${projectId}`,
    "(Turn this email off in Settings → Privacy & reports.)",
  ].join("\n");
}

/** Sends the weekly summary to every project that is due. Called from the cron endpoint. */
export async function sendDueDigests(): Promise<number> {
  if (!process.env.RESEND_API_KEY) return 0;
  const due = all<DigestProject>(
    `SELECT id, name, alert_email FROM projects
      WHERE weekly_digest = 1 AND alert_email IS NOT NULL AND alert_email <> ''
        AND (last_digest_at IS NULL OR last_digest_at <= datetime('now', '-7 days'))`,
  );
  let sent = 0;
  for (const p of due) {
    try {
      await sendMail(p.alert_email, digestEmail(digestData(p.id, p.name), { url: unsubUrl(p.id), headers: unsubHeaders(p.id) }));
      run("UPDATE projects SET last_digest_at = datetime('now') WHERE id = ?", p.id);
      sent++;
    } catch (err) {
      console.error(`[digest] project ${p.id} failed:`, err);
    }
  }
  return sent;
}
