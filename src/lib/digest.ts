import { all, get, run } from "./db";
import { sendEmail } from "./email";
import { projectHealth } from "./health";

interface DigestProject { id: number; name: string; alert_email: string }

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
      await sendEmail(p.alert_email, `Your weekly AI quality summary · ${p.name}`, digestText(p.id, p.name, process.env.APP_URL || ""));
      run("UPDATE projects SET last_digest_at = datetime('now') WHERE id = ?", p.id);
      sent++;
    } catch (err) {
      console.error(`[digest] project ${p.id} failed:`, err);
    }
  }
  return sent;
}
