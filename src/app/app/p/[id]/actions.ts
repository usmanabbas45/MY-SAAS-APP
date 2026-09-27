"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parseTranscripts } from "@/lib/audit/parse";
import { createAudit, executeAudit } from "@/lib/audit/run";
import { requireUser } from "@/lib/auth";
import { get, run } from "@/lib/db";
import { raiseIncident } from "@/lib/incidents";
import { VERDICTS, type Verdict } from "@/lib/judge/types";
import { retrainRiskModel } from "@/lib/ml/risk";
import { newApiKey, ownedProject, type Project } from "@/lib/projects";
import { assertPublicUrl, encrypt } from "@/lib/security";
import { renderBody, runSuite } from "@/lib/tests/runner";
import { pollSource } from "@/lib/workflows/pollers";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

async function project(form: FormData): Promise<Project> {
  const user = await requireUser();
  return ownedProject(user.id, Number(form.get("projectId")));
}

function str(form: FormData, key: string, max = 20000): string {
  return String(form.get(key) ?? "").trim().slice(0, max);
}

function done(path: string, msg: { ok?: string; error?: string }): never {
  revalidatePath(path);
  const q = new URLSearchParams(msg as Record<string, string>).toString();
  redirect(`${path}${q ? `?${q}` : ""}`);
}

async function fileText(form: FormData, key: string): Promise<string> {
  const f = form.get(key);
  if (!(f instanceof File) || f.size === 0) return "";
  if (f.size > MAX_UPLOAD_BYTES) throw new Error(`"${f.name}" is larger than 8 MB. Split it into smaller files.`);
  return f.text();
}

// ---------- Knowledge base ----------

export async function addKbDocAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/chatbot`;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  let added = 0;
  try {
    for (const f of files) {
      if (f.size > MAX_UPLOAD_BYTES) throw new Error(`"${f.name}" is larger than 8 MB.`);
      const text = (await f.text()).trim();
      if (text) {
        run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, ?, ?)", p.id, f.name.replace(/\.(txt|md|markdown|csv|html?)$/i, "").slice(0, 200), text);
        added++;
      }
    }
  } catch (err) {
    done(path, { error: err instanceof Error ? err.message : "Upload failed" });
  }
  const title = str(form, "title", 200);
  const content = str(form, "content", 500000);
  if (title && content) {
    run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, ?, ?)", p.id, title, content);
    added++;
  }
  if (added === 0) done(path, { error: "Add a title and content, or upload .txt/.md files." });
  done(path, { ok: `Added ${added} help article${added > 1 ? "s" : ""} to the knowledge base.` });
}

export async function deleteKbDocAction(form: FormData) {
  const p = await project(form);
  run("DELETE FROM kb_docs WHERE id = ? AND project_id = ?", Number(form.get("docId")), p.id);
  done(`/app/p/${p.id}/chatbot`, { ok: "Article removed." });
}

// ---------- Chatbot audits ----------

export async function startAuditAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/chatbot`;
  let conversations;
  try {
    const text = (await fileText(form, "file")) || str(form, "pasted", MAX_UPLOAD_BYTES);
    conversations = parseTranscripts(text);
  } catch (err) {
    done(path, { error: err instanceof Error ? err.message : "Could not read the transcripts." });
  }
  const name = str(form, "name", 120) || `Audit ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const { id } = createAudit(p.id, name);
  void executeAudit(id, p.id, conversations); // runs in the background; the page auto-refreshes
  redirect(`${path}/audit/${id}`);
}

export async function deleteAuditAction(form: FormData) {
  const p = await project(form);
  run("DELETE FROM audits WHERE id = ? AND project_id = ?", Number(form.get("auditId")), p.id);
  done(`/app/p/${p.id}/chatbot`, { ok: "Audit deleted." });
}

export async function feedbackAction(form: FormData) {
  const p = await project(form);
  const itemId = Number(form.get("itemId"));
  const auditId = Number(form.get("auditId"));
  const owned = get("SELECT i.id FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE i.id = ? AND a.project_id = ?", itemId, p.id);
  if (!owned) done(`/app/p/${p.id}/chatbot`, { error: "Answer not found." });
  const choice = String(form.get("choice") ?? "");
  if (choice === "agree") {
    run("UPDATE audit_items SET feedback = 'agree', corrected_verdict = NULL WHERE id = ?", itemId);
  } else if ((VERDICTS as readonly string[]).includes(choice)) {
    run("UPDATE audit_items SET feedback = 'disagree', corrected_verdict = ? WHERE id = ?", choice as Verdict, itemId);
  } else if (choice === "clear") {
    run("UPDATE audit_items SET feedback = NULL, corrected_verdict = NULL WHERE id = ?", itemId);
  }
  const back = String(form.get("back") ?? "");
  revalidatePath(`/app/p/${p.id}/chatbot/audit/${auditId}`);
  redirect(`/app/p/${p.id}/chatbot/audit/${auditId}${back.startsWith("?") ? back : ""}#item-${itemId}`);
}

// ---------- Chatbot tests ----------

export async function addTargetAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/tests`;
  const name = str(form, "name", 120) || "My chatbot";
  const url = str(form, "url", 2000);
  const template = str(form, "body_template", 10000) || '{"message":"{{question}}"}';
  const responsePath = str(form, "response_path", 300);
  const headersRaw = str(form, "headers", 5000);
  try {
    await assertPublicUrl(url);
    if (!template.includes("{{question}}")) throw new Error("The request body must contain {{question}}.");
    renderBody(template, "test");
    let headersEnc: string | null = null;
    if (headersRaw) {
      const h = JSON.parse(headersRaw) as unknown;
      if (!h || typeof h !== "object" || Array.isArray(h) || Object.values(h).some((v) => typeof v !== "string")) {
        throw new Error('Headers must be a JSON object of strings, e.g. {"Authorization": "Bearer ..."}');
      }
      headersEnc = encrypt(JSON.stringify(h));
    }
    run("INSERT INTO bot_targets (project_id, name, url, headers_enc, body_template, response_path) VALUES (?, ?, ?, ?, ?, ?)",
      p.id, name, url, headersEnc, template, responsePath);
  } catch (err) {
    done(path, { error: err instanceof SyntaxError ? "Headers or body template is not valid JSON." : err instanceof Error ? err.message : "Invalid bot settings." });
  }
  done(path, { ok: `Bot "${name}" connected. Add test questions, then click Run tests.` });
}

export async function deleteTargetAction(form: FormData) {
  const p = await project(form);
  run("DELETE FROM bot_targets WHERE id = ? AND project_id = ?", Number(form.get("targetId")), p.id);
  done(`/app/p/${p.id}/tests`, { ok: "Bot removed." });
}

export async function addTestCaseAction(form: FormData) {
  const p = await project(form);
  const question = str(form, "question", 2000);
  const expected = str(form, "expected", 4000);
  if (!question || !expected) done(`/app/p/${p.id}/tests`, { error: "Question and expected facts are required." });
  run("INSERT INTO test_cases (project_id, question, expected, must_not) VALUES (?, ?, ?, ?)", p.id, question, expected, str(form, "must_not", 4000));
  done(`/app/p/${p.id}/tests`, { ok: "Test question added." });
}

export async function deleteTestCaseAction(form: FormData) {
  const p = await project(form);
  run("DELETE FROM test_cases WHERE id = ? AND project_id = ?", Number(form.get("caseId")), p.id);
  done(`/app/p/${p.id}/tests`, { ok: "Test question removed." });
}

export async function runTestsAction(form: FormData) {
  const p = await project(form);
  const targetId = Number(form.get("targetId"));
  const path = `/app/p/${p.id}/tests`;
  if (!get("SELECT id FROM bot_targets WHERE id = ? AND project_id = ?", targetId, p.id)) done(path, { error: "Bot not found." });
  let msg: { ok?: string; error?: string };
  try {
    const r = await runSuite(targetId);
    msg = r.failed ? { error: `${r.failed} test${r.failed > 1 ? "s" : ""} failed, ${r.passed} passed. See details below.` } : { ok: `All ${r.passed} tests passed.` };
  } catch (err) {
    msg = { error: err instanceof Error ? err.message : "Test run failed." };
  }
  done(path, msg);
}

// ---------- Workflows ----------

export async function addWorkflowSourceAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/workflows`;
  const platform = str(form, "platform") === "make" ? "make" : "n8n";
  const baseUrl = str(form, "base_url", 500).replace(/\/+$/, "");
  const apiKey = str(form, "api_key", 2000);
  const scenarios = str(form, "scenario_ids", 1000);
  const interval = Number(str(form, "expected_interval_min")) || null;
  try {
    await assertPublicUrl(baseUrl);
    if (!apiKey) throw new Error("API key is required.");
    if (platform === "make" && !scenarios) throw new Error("Add at least one Make scenario ID.");
  } catch (err) {
    done(path, { error: err instanceof Error ? err.message : "Invalid settings." });
  }
  const { lastInsertRowid } = run(
    "INSERT INTO workflow_sources (project_id, platform, name, base_url, api_key_enc, scenario_ids, expected_interval_min) VALUES (?, ?, ?, ?, ?, ?, ?)",
    p.id, platform, str(form, "name", 120) || (platform === "n8n" ? "n8n" : "Make"), baseUrl, encrypt(apiKey), scenarios, interval,
  );
  const src = get<Parameters<typeof pollSource>[0]>("SELECT * FROM workflow_sources WHERE id = ?", lastInsertRowid)!;
  const result = await pollSource(src);
  done(path, result.error
    ? { error: `Saved, but the first check failed: ${result.error}. Fix the URL/key and click "Check now".` }
    : { ok: `Connected! Imported ${result.added} recent execution${result.added === 1 ? "" : "s"}.` });
}

export async function pollNowAction(form: FormData) {
  const p = await project(form);
  const src = get<Parameters<typeof pollSource>[0]>("SELECT * FROM workflow_sources WHERE id = ? AND project_id = ?", Number(form.get("sourceId")), p.id);
  if (!src) done(`/app/p/${p.id}/workflows`, { error: "Connection not found." });
  const r = await pollSource(src);
  done(`/app/p/${p.id}/workflows`, r.error ? { error: r.error } : { ok: `Checked. ${r.added} new execution${r.added === 1 ? "" : "s"}.` });
}

export async function deleteSourceAction(form: FormData) {
  const p = await project(form);
  run("DELETE FROM workflow_sources WHERE id = ? AND project_id = ?", Number(form.get("sourceId")), p.id);
  done(`/app/p/${p.id}/workflows`, { ok: "Connection removed." });
}

// ---------- Incidents ----------

export async function resolveIncidentAction(form: FormData) {
  const p = await project(form);
  const id = form.get("incidentId");
  if (id === "all") run("UPDATE incidents SET resolved = 1 WHERE project_id = ?", p.id);
  else run("UPDATE incidents SET resolved = 1 WHERE id = ? AND project_id = ?", Number(id), p.id);
  done(`/app/p/${p.id}/incidents`, { ok: "Marked as resolved." });
}

// ---------- Settings ----------

export async function updateSettingsAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/settings`;
  const webhook = str(form, "alert_webhook", 2000) || null;
  const email = str(form, "alert_email", 300) || null;
  try {
    if (webhook) await assertPublicUrl(webhook);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid alert email.");
  } catch (err) {
    done(path, { error: err instanceof Error ? err.message : "Invalid settings." });
  }
  const num = (k: string, fallback: number, min: number, max: number) => {
    const n = Number(form.get(k));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  run(
    `UPDATE projects SET name = ?, alert_webhook = ?, alert_email = ?, agent_cost_budget_usd = ?, agent_max_steps = ?, agent_max_ms = ?, agent_ai_review = ? WHERE id = ?`,
    str(form, "name", 100) || p.name, webhook, email,
    num("agent_cost_budget_usd", p.agent_cost_budget_usd, 0.0001, 10000),
    Math.round(num("agent_max_steps", p.agent_max_steps, 1, 100000)),
    Math.round(num("agent_max_seconds", p.agent_max_ms / 1000, 1, 86400) * 1000),
    form.get("agent_ai_review") ? 1 : 0, p.id,
  );
  done(path, { ok: "Settings saved." });
}

export async function testAlertAction(form: FormData) {
  const p = await project(form);
  if (!p.alert_webhook && !p.alert_email) done(`/app/p/${p.id}/settings`, { error: "Add a webhook URL or email first, then save." });
  await raiseIncident(p.id, {
    module: "workflows", code: "TEST_ALERT", severity: "medium",
    title: "Test alert from AgentProof", detail: "If you can read this, alerts are working.",
  });
  done(`/app/p/${p.id}/settings`, { ok: "Test alert sent. Check your Slack/Discord channel or inbox." });
}

export async function regenerateKeyAction(form: FormData) {
  const p = await project(form);
  run("UPDATE projects SET api_key = ? WHERE id = ?", newApiKey(), p.id);
  done(`/app/p/${p.id}/settings`, { ok: "New API key created. Update it in your agents and workflows - the old key no longer works." });
}

export async function retrainAction(form: FormData) {
  const p = await project(form);
  const r = retrainRiskModel(p.id);
  done(`/app/p/${p.id}/settings`, r.ok
    ? { ok: `Neural model trained on ${r.samples} reviewed answers. Validation accuracy ${(r.valAccuracy * 100).toFixed(0)}% (judge alone: ${(r.baselineAccuracy * 100).toFixed(0)}%). Re-scored ${r.rescored} answers.` }
    : { error: r.reason });
}

export async function deleteProjectAction(form: FormData) {
  const p = await project(form);
  if (str(form, "confirm") !== p.name) done(`/app/p/${p.id}/settings`, { error: "Type the project name exactly to delete it." });
  run("DELETE FROM projects WHERE id = ?", p.id);
  redirect("/app?new=1");
}
