import { z } from "zod";
import { json, readIngest } from "@/lib/api";
import { limitError, projectOwner } from "@/lib/billing";
import { pushCrmRecords } from "@/lib/crm/monitor";
import { toIso } from "@/lib/crm/providers";
import { get } from "@/lib/db";

const when = z.union([z.string().max(50), z.number()]).nullish();
const RecordSchema = z.object({
  id: z.union([z.string().min(1).max(200), z.number()]),
  kind: z.enum(["contact", "lead", "deal"]).default("contact"),
  created_at: when, updated_at: when, last_activity_at: when,
  email: z.string().max(320).nullish(), phone: z.string().max(60).nullish(), name: z.string().max(300).nullish(), owner: z.union([z.string().max(200), z.number()]).nullish(),
});
const PushSchema = z.object({ source: z.string().min(1).max(120).default("My CRM"), records: z.array(RecordSchema).min(1).max(500) });

/**
 * Any CRM via n8n, Make or Zapier: send contacts/leads when they are created or updated. ProofMyAI keeps only hashes
 * and filled/empty flags, and checks for stopped lead flow, duplicates, missing fields and bulk changes.
 */
export async function POST(req: Request) {
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const parsed = PushSchema.safeParse(r.body);
  if (!parsed.success) return json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  const { source, records } = parsed.data;
  if (!get("SELECT 1 FROM crm_sources WHERE project_id = ? AND provider = 'push' AND name = ?", r.project.id, source)) {
    const over = limitError(projectOwner(r.project.id), "monitors");
    if (over) return json({ error: over }, 402);
  }
  const summary = await pushCrmRecords(r.project.id, source, records.map((x) => ({
    id: String(x.id), kind: x.kind, createdAt: toIso(x.created_at), updatedAt: toIso(x.updated_at), email: x.email ?? null, phone: x.phone ?? null,
    name: x.name ?? null, owner: x.owner == null ? null : String(x.owner), ...(x.last_activity_at !== undefined ? { lastActivityAt: toIso(x.last_activity_at) } : {}),
  })));
  return json({ received: summary.fetched, new: summary.created, duplicates: summary.duplicates }, 202);
}
