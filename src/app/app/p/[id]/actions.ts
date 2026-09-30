"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parseTranscripts } from "@/lib/audit/parse";
import { createAudit, executeAudit } from "@/lib/audit/run";
import { customMatcher, redactConversations } from "@/lib/pii";
import { RETENTION_OPTIONS } from "@/lib/retention";
import { processLiveChat } from "@/lib/audit/live";
import { ingestAgentRun } from "@/lib/agents/ingest";
import { pollChatSource, type ChatSource } from "@/lib/connectors/twilio";
import { recordWorkflowRun } from "@/lib/workflows/monitor";
import { CHANNEL_TYPES, channelsFor, deliver, MODULES, validateChannel } from "@/lib/notify";
import { requireUser } from "@/lib/auth";
import { limitError } from "@/lib/billing";
import { get, run } from "@/lib/db";
import { raiseIncident } from "@/lib/incidents";
import { VERDICTS, type Verdict } from "@/lib/judge/types";
import { retrainRiskModel } from "@/lib/ml/risk";
import { newApiKey, ownedProject, type Project } from "@/lib/projects";
import { parseMustInclude, RULE_KINDS } from "@/lib/rules";
import { assertPublicUrl, encrypt, randomToken, rateLimit } from "@/lib/security";
import { normalisePhone, wahaConfigured, whatsappChatId } from "@/lib/whatsapp";
import { renderBody, runSuite, startSuiteInBackground } from "@/lib/tests/runner";
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
    if (p.redact_pii) conversations = redactConversations(conversations, customMatcher(p.mask_terms));
  } catch (err) {
    done(path, { error: err instanceof Error ? err.message : "Could not read the transcripts." });
  }
  const over = limitError(p.user_id, "conversations", conversations.length);
  if (over) done(path, { error: `This file has ${conversations.length} conversations. ${over}` });
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

// ---------- Custom rules ----------

export async function addRuleAction(form: FormData) {
  const p = await project(form);
  const kind = str(form, "kind");
  const pattern = str(form, "pattern", 200);
  const path = `/app/p/${p.id}/chatbot`;
  if (!(kind in RULE_KINDS)) done(path, { error: "Choose a rule type." });
  if (pattern.length < 2) done(path, { error: "Type the word or phrase for the rule (at least 2 characters)." });
  if (kind === "must_include" && !parseMustInclude(pattern)) done(path, { error: "Write this rule as: topic => required words, e.g. windscreen => not covered" });
  run("INSERT INTO rules (project_id, kind, pattern) VALUES (?, ?, ?)", p.id, kind, pattern);
  done(path, { ok: "Rule added. It applies to every new audit and every live answer." });
}

export async function deleteRuleAction(form: FormData) {
  const p = await project(form);
  run("DELETE FROM rules WHERE id = ? AND project_id = ?", Number(form.get("ruleId")), p.id);
  done(`/app/p/${p.id}/chatbot`, { ok: "Rule removed." });
}

// ---------- Client reports ----------

export async function shareAuditAction(form: FormData) {
  const p = await project(form);
  const auditId = Number(form.get("auditId"));
  const path = `/app/p/${p.id}/chatbot/audit/${auditId}`;
  if (!get("SELECT id FROM audits WHERE id = ? AND project_id = ?", auditId, p.id)) done(`/app/p/${p.id}/chatbot`, { error: "Audit not found." });
  if (form.get("revoke")) {
    run("UPDATE audits SET share_token = NULL WHERE id = ?", auditId);
    done(path, { ok: "Share link turned off. The old link no longer works." });
  }
  run("UPDATE audits SET share_token = ? WHERE id = ?", randomToken(18), auditId);
  done(path, { ok: "Share link created. Anyone with the link can view this report (read-only)." });
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
  const over = limitError(p.user_id, "bots");
  if (over) done(path, { error: over });
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

export async function addWhatsAppTargetAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/tests`;
  if (!wahaConfigured()) done(path, { error: "WhatsApp testing isn't available yet. Use an HTTP endpoint or contact support." });
  const phone = normalisePhone(str(form, "phone", 40));
  if (!phone) done(path, { error: "Enter the bot's WhatsApp number with country code, e.g. +92 300 1234567." });
  const over = limitError(p.user_id, "bots");
  if (over) done(path, { error: over });
  if (get("SELECT 1 FROM bot_targets t JOIN projects pr ON pr.id = t.project_id WHERE t.kind = 'whatsapp' AND t.phone = ? AND pr.user_id <> ?", phone, p.user_id)) {
    done(path, { error: "This number is already being tested by another account. Contact support if it's yours." });
  }
  if (form.get("confirm") !== "1") done(path, { error: "Please confirm that this is your own bot's number." });
  try {
    await whatsappChatId(phone!);
  } catch (err) {
    done(path, { error: err instanceof Error ? err.message : "Could not check this number." });
  }
  const name = str(form, "name", 120) || "WhatsApp bot";
  run("INSERT INTO bot_targets (project_id, name, url, body_template, response_path, kind, phone) VALUES (?, ?, ?, '', '', 'whatsapp', ?)",
    p.id, name, `whatsapp:+${phone}`, phone);
  done(path, { ok: `WhatsApp bot +${phone} connected. Add test questions, then click Run tests.` });
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
  const target = get<{ kind: string }>("SELECT kind FROM bot_targets WHERE id = ? AND project_id = ?", targetId, p.id);
  if (!target) done(path, { error: "Bot not found." });
  if (target!.kind === "whatsapp") {
    if (!rateLimit(`wa-run:${targetId}`, 3, 86400000)) done(path, { error: "WhatsApp tests can be started by hand 3 times a day (they also run automatically every night)." });
    if (!get("SELECT 1 FROM test_cases WHERE project_id = ?", p.id)) done(path, { error: "Add at least one test question first." });
    done(path, startSuiteInBackground(targetId)
      ? { ok: "WhatsApp test started. ProofMyAI is messaging your bot now; results appear here in a few minutes." }
      : { error: "A test for this bot is already running. Results appear here in a few minutes." });
  }
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
  const over = limitError(p.user_id, "monitors");
  if (over) done(path, { error: over });
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
    `UPDATE projects SET name = ?, alert_webhook = ?, alert_email = ?, agent_cost_budget_usd = ?, agent_max_steps = ?, agent_max_ms = ?, agent_ai_review = ?,
       weekly_digest = ?, report_brand = ?, reply_timeout_sec = ? WHERE id = ?`,
    str(form, "name", 100) || p.name, webhook, email,
    num("agent_cost_budget_usd", p.agent_cost_budget_usd, 0.0001, 10000),
    Math.round(num("agent_max_steps", p.agent_max_steps, 1, 100000)),
    Math.round(num("agent_max_seconds", p.agent_max_ms / 1000, 1, 86400) * 1000),
    form.get("agent_ai_review") ? 1 : 0, form.get("weekly_digest") ? 1 : 0,
    str(form, "report_brand", 80) || null, Math.round(num("reply_timeout_sec", p.reply_timeout_sec, 0, 86400)), p.id,
  );
  done(path, { ok: "Settings saved." });
}

// ---------- Live tracking: test events and Twilio connector ----------

export async function sendTestEventAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/live`;
  const stamp = Date.now().toString(36);
  // A sample conversation where the bot asks again for a registration the customer already gave.
  await (await processLiveChat(p, {
    conversation_id: `test-${stamp}`, bot_name: "Test",
    messages: [
      { role: "user", content: "Hi, my car AB12 CDE won't start. Can someone help?" },
      { role: "assistant", content: "Sorry to hear that! What is your vehicle registration number?" },
    ],
    latency_ms: 1840, cost_usd: 0.0021,
  }, { wait: true })).grades;
  await ingestAgentRun(p.id, {
    run_id: `test-${stamp}`, agent_name: "Test agent", goal: "Summarise today's support tickets", status: "success",
    final_output: "3 tickets: 2 delivery questions, 1 refund request.",
    steps: [{ type: "llm", name: "summarise", tokens: 640, cost_usd: 0.003, duration_ms: 1200 }],
  });
  await recordWorkflowRun(p.id, { platform: "other", workflow_id: "test-workflow", workflow_name: "Test workflow", execution_id: `test-${stamp}`, status: "success", output_items: 5, duration_ms: 2300 });
  done(path, { ok: "Test events sent: a chatbot conversation (with a “asked again” problem), an agent run and a workflow run. They appear in the feed below." });
}

export async function addChatSourceAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/live`;
  const accountSid = str(form, "account_sid", 64);
  const keySid = str(form, "key_sid", 64);
  const secret = str(form, "secret", 200);
  const botNumber = str(form, "bot_number", 60).replace(/\s+/g, "");
  try {
    if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) throw new Error("The Account SID starts with AC and has 34 characters (Twilio Console → Account info).");
    if (keySid && !/^SK[0-9a-f]{32}$/i.test(keySid)) throw new Error("An API key SID starts with SK and has 34 characters.");
    if (!secret) throw new Error("Enter the API key secret (or the auth token).");
    if (!/^(whatsapp:)?\+\d{6,15}$/i.test(botNumber)) throw new Error("Enter the bot's number in international format, e.g. whatsapp:+14155238886 or +447700900123.");
  } catch (err) {
    done(path, { error: err instanceof Error ? err.message : "Invalid Twilio details." });
  }
  const { lastInsertRowid } = run(
    "INSERT INTO chat_sources (project_id, platform, name, account_id, secret_enc, bot_address) VALUES (?, 'twilio', ?, ?, ?, ?)",
    p.id, str(form, "name", 100) || "Twilio", accountSid, encrypt(JSON.stringify({ keySid: keySid || undefined, secret })), botNumber,
  );
  const src = get<ChatSource>("SELECT * FROM chat_sources WHERE id = ?", lastInsertRowid)!;
  const r = await pollChatSource(src);
  done(path, r.error
    ? { error: `Saved, but the first check failed: ${r.error}` }
    : { ok: `Connected! Imported ${r.replies} bot repl${r.replies === 1 ? "y" : "ies"} from the last 24 hours${r.waiting ? ` and ${r.waiting} unanswered customer message${r.waiting === 1 ? "" : "s"}` : ""}. New messages are checked every 15 minutes.` });
}

export async function pollChatSourceAction(form: FormData) {
  const p = await project(form);
  const src = get<ChatSource>("SELECT * FROM chat_sources WHERE id = ? AND project_id = ?", Number(form.get("sourceId")), p.id);
  if (!src) done(`/app/p/${p.id}/live`, { error: "Connection not found." });
  const r = await pollChatSource(src);
  done(`/app/p/${p.id}/live`, r.error ? { error: r.error } : { ok: `Checked: ${r.replies} new repl${r.replies === 1 ? "y" : "ies"}, ${r.waiting} waiting for a reply.` });
}

export async function deleteChatSourceAction(form: FormData) {
  const p = await project(form);
  run("DELETE FROM chat_sources WHERE id = ? AND project_id = ?", Number(form.get("sourceId")), p.id);
  done(`/app/p/${p.id}/live`, { ok: "Twilio connection removed." });
}

export async function updatePrivacyAction(form: FormData) {
  const p = await project(form);
  const days = Number(form.get("retention_days"));
  const terms = str(form, "mask_terms", 20000).split(/\r?\n/).map((t) => t.trim()).filter(Boolean).slice(0, 300).join("\n");
  run(
    "UPDATE projects SET redact_pii = ?, mask_terms = ?, retention_days = ?, store_text = ?, use_ai = ? WHERE id = ?",
    form.get("redact_pii") ? 1 : 0, terms || null,
    (RETENTION_OPTIONS as readonly number[]).includes(days) ? days : p.retention_days,
    form.get("store_text") ? 1 : 0, form.get("use_ai") ? 1 : 0, p.id,
  );
  done(`/app/p/${p.id}/settings`, { ok: "Privacy settings saved. They apply to new data from now on; old data is removed by the retention setting." });
}

export async function testAlertAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/settings`;
  const only = Number(form.get("channelId")) || null;
  const channels = channelsFor(p.id).filter((c) => !only || c.id === only);
  if (!channels.length && !p.alert_webhook && !p.alert_email) done(path, { error: "Add a notification channel first." });
  const msg = { projectId: p.id, projectName: p.name, kind: "problem" as const, module: "workflows", code: "TEST_ALERT", severity: "high" as const,
    title: "Test alert from ProofMyAI", detail: "If you can read this, alerts to this channel are working.", link: `${process.env.APP_URL ?? ""}/app/p/${p.id}/incidents` };
  const results = await Promise.allSettled(channels.map((c) => deliver(c, msg)));
  const failed: string[] = [];
  results.forEach((r, i) => {
    const status = r.status === "fulfilled" ? "ok" : String(r.reason instanceof Error ? r.reason.message : r.reason).slice(0, 200);
    if (r.status === "rejected") failed.push(`${CHANNEL_TYPES[channels[i].type].label}: ${status}`);
    run("UPDATE alert_channels SET last_status = ?, last_sent_at = ? WHERE id = ?", status, new Date().toISOString(), channels[i].id);
  });
  if (!only && (p.alert_webhook || p.alert_email)) {
    await raiseIncident(p.id, { module: "workflows", code: "TEST_ALERT", severity: "medium", title: "Test alert from ProofMyAI", detail: "If you can read this, alerts are working." });
  }
  done(path, failed.length ? { error: `Some alerts failed. ${failed.join(" · ")}` } : { ok: "Test alert sent. Check your phone, inbox or channel." });
}

export async function addChannelAction(form: FormData) {
  const p = await project(form);
  const path = `/app/p/${p.id}/settings`;
  let ch;
  try {
    ch = await validateChannel(str(form, "type"), str(form, "target", 2000), { token: str(form, "token", 300), sid: str(form, "sid", 64), from: str(form, "from", 40) });
  } catch (err) {
    done(path, { error: err instanceof Error ? err.message : "Invalid channel." });
  }
  if (channelsFor(p.id).length >= 20) done(path, { error: "A project can have up to 20 notification channels." });
  const sev = str(form, "min_severity");
  const modules = form.getAll("modules").map(String).filter((m) => (MODULES as readonly string[]).includes(m));
  run(
    "INSERT INTO alert_channels (project_id, type, target, secret_enc, min_severity, modules, notify_resolved) VALUES (?, ?, ?, ?, ?, ?, ?)",
    p.id, ch.type, ch.target, ch.secret ? encrypt(ch.secret) : null, ["low", "medium", "high"].includes(sev) ? sev : "medium",
    modules.length === MODULES.length ? "" : modules.join(","), form.get("notify_resolved") ? 1 : 0,
  );
  done(path, { ok: `${CHANNEL_TYPES[ch.type].label} added. Click "Test" next to it to check it works.` });
}

export async function deleteChannelAction(form: FormData) {
  const p = await project(form);
  run("DELETE FROM alert_channels WHERE id = ? AND project_id = ?", Number(form.get("channelId")), p.id);
  done(`/app/p/${p.id}/settings`, { ok: "Notification channel removed." });
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
