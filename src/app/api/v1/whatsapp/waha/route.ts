import { json } from "@/lib/api";
import { processLiveChat } from "@/lib/audit/live";
import { limitError, projectOwner } from "@/lib/billing";
import { run } from "@/lib/db";
import { customMatcher, redactPII } from "@/lib/pii";
import { projectFromRequest } from "@/lib/projects";
import { rateLimit } from "@/lib/security";
import { wahaToLiveEvent, type WahaEvent } from "@/lib/whatsapp";

/**
 * WhatsApp live monitoring without code: add this URL as a webhook in your WAHA session
 * (events "message.any", or "message" + "message.any"), with header X-Api-Key: <project API key>
 * or ?key=<project API key>. Customer messages and your bot's replies are paired and graded.
 */
export async function POST(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  const authed = key && !req.headers.get("x-api-key") && !req.headers.get("authorization")
    ? new Request(req.url, { method: "POST", headers: { "x-api-key": key } })
    : req;
  const project = projectFromRequest(authed);
  if (!project) return json({ error: "Missing or invalid API key. Add header X-Api-Key: ap_live_... or ?key=ap_live_..." }, 401);
  if (!rateLimit(`ingest:${project.id}`, 600, 60000)) return json({ error: "Rate limit exceeded (600 requests/minute)" }, 429);

  let event: WahaEvent;
  try {
    event = (await req.json()) as WahaEvent;
  } catch {
    return json({ error: "Body must be valid JSON" }, 400);
  }
  // Mask personal data before the message is stored anywhere, including the pairing table.
  if (event.payload?.body && project.redact_pii) {
    event = { ...event, payload: { ...event.payload, body: redactPII(event.payload.body, customMatcher(project.mask_terms)) } };
  }
  run("DELETE FROM wa_last_question WHERE project_id = ? AND at_ms < ?", project.id, Date.now() - 7 * 86400000);
  const live = wahaToLiveEvent(project.id, event);
  // Always answer 200 for events we skip, so WAHA doesn't retry them.
  if (!live) return json({ ignored: true }, 200);
  if (live.answer) {
    const over = limitError(projectOwner(project.id), "conversations");
    if (over) return json({ error: over }, 402);
  }
  try {
    const { exchanges } = await processLiveChat(project, live);
    return json({ accepted: exchanges.length, kind: live.answer ? "reply" : "customer_message" }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Invalid event" }, 400);
  }
}
