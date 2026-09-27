import { json, readIngest } from "@/lib/api";
import { recordWorkflowRun, WorkflowRunSchema } from "@/lib/workflows/monitor";

export async function POST(req: Request) {
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const items = Array.isArray(r.body) ? r.body : [r.body];
  if (items.length > 500) return json({ error: "Send at most 500 runs per request" }, 413);
  let created = 0;
  for (const [i, item] of items.entries()) {
    const parsed = WorkflowRunSchema.safeParse(item);
    if (!parsed.success) {
      return json({ error: `Item ${i}: ${parsed.error.issues.map((x) => `${x.path.join(".") || "body"}: ${x.message}`).join("; ")}`, created }, 400);
    }
    if (await recordWorkflowRun(r.project.id, parsed.data)) created++;
  }
  return json({ received: items.length, created, duplicates: items.length - created }, 201);
}
