import { get, run } from "./db";
import { safeFetch } from "./security";

export type Module = "chatbot" | "tests" | "agents" | "workflows";
export type IncidentSeverity = "low" | "medium" | "high";

export interface NewIncident {
  module: Module;
  code: string;
  severity: IncidentSeverity;
  title: string;
  detail: string;
  /** Incidents with the same open dedupe key are not repeated (avoids alert storms). */
  dedupeKey?: string;
}

export async function raiseIncident(projectId: number, inc: NewIncident): Promise<boolean> {
  if (inc.dedupeKey) {
    const open = get("SELECT id FROM incidents WHERE project_id = ? AND dedupe_key = ? AND resolved = 0", projectId, inc.dedupeKey);
    if (open) return false;
  }
  run(
    "INSERT INTO incidents (project_id, module, code, severity, title, detail, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
    projectId, inc.module, inc.code, inc.severity, inc.title, inc.detail, inc.dedupeKey ?? null,
  );
  if (inc.severity !== "low") await sendAlert(projectId, inc);
  return true;
}

export function resolveIncidents(projectId: number, dedupeKey: string): void {
  run("UPDATE incidents SET resolved = 1 WHERE project_id = ? AND dedupe_key = ? AND resolved = 0", projectId, dedupeKey);
}

async function sendAlert(projectId: number, inc: NewIncident): Promise<void> {
  const project = get<{ name: string; alert_webhook: string | null; alert_email: string | null }>(
    "SELECT name, alert_webhook, alert_email FROM projects WHERE id = ?", projectId,
  );
  if (!project) return;
  const link = `${process.env.APP_URL ?? ""}/app/p/${projectId}`;
  const text = `[ProofMyAI · ${project.name}] ${inc.severity.toUpperCase()}: ${inc.title}\n${inc.detail}\n${link}`;
  const jobs: Promise<unknown>[] = [];

  if (project.alert_webhook) {
    // `text` is read by Slack/Teams/Google Chat, `content` by Discord; extra fields help custom receivers.
    jobs.push(
      safeFetch(project.alert_webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, content: text, severity: inc.severity, module: inc.module, code: inc.code, link }),
      }, 10000),
    );
  }
  if (project.alert_email && process.env.RESEND_API_KEY) {
    jobs.push(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.ALERT_FROM_EMAIL || "alerts@proofmyai.com",
          to: [project.alert_email],
          subject: `[ProofMyAI] ${inc.title}`,
          text,
        }),
        signal: AbortSignal.timeout(10000),
      }),
    );
  }
  // Alert delivery failures must never break monitoring itself.
  const results = await Promise.allSettled(jobs);
  results.forEach((r) => {
    if (r.status === "rejected") console.error("[alerts] delivery failed:", r.reason);
  });
}
