import crypto from "node:crypto";
import { all } from "@/lib/db";
import { sendDueDigests } from "@/lib/digest";
import { purgeExpired } from "@/lib/retention";
import { recordCronRun } from "@/lib/status";
import { processFoundingPeriods } from "@/lib/founding";
import { recordDailyMetrics } from "@/lib/analytics";
import { alertMissingReplies } from "@/lib/audit/live";
import { pollAllChatSources } from "@/lib/connectors";
import { runDueSuites } from "@/lib/tests/runner";
import { periodicWorkflowChecks } from "@/lib/workflows/monitor";
import { pollAllSources } from "@/lib/workflows/pollers";
import { runDueMonitors } from "@/lib/uptime";
import { purgeOldErrors } from "@/lib/monitoring";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || new URL(req.url).searchParams.get("secret") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Call every 15 minutes: polls n8n/Make, runs periodic checks, and runs chatbot test suites due in the last 24h. */
export async function GET(req: Request) {
  if (!authorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const started = Date.now();
  try {
    return await runAll(started);
  } catch (err) {
    recordCronRun(false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function runAll(started: number) {
  await pollAllSources();
  const projects = all<{ id: number }>("SELECT id FROM projects");
  for (const p of projects) await periodicWorkflowChecks(p.id);
  const suites = await runDueSuites();
  const digests = await sendDueDigests();
  const chatSources = await pollAllChatSources();
  const noReply = await alertMissingReplies();
  const uptimeChecks = await runDueMonitors();
  const purged = purgeExpired();
  purgeOldErrors();
  const founding = await processFoundingPeriods();
  recordDailyMetrics();
  recordCronRun(true);
  return Response.json({ ok: true, projects: projects.length, testSuitesRun: suites, digestsSent: digests, chatSources, unansweredAlerted: noReply, uptimeChecks, purged, founding, ms: Date.now() - started });
}
