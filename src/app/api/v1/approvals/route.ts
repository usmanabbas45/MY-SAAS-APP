import { json, readIngest } from "@/lib/api";
import { ApprovalSchema, publicApproval, submitApproval } from "@/lib/approvals";

/**
 * Submit an action your agent is about to take. Routine, reversible actions come back "approved"; anything
 * irreversible, new, over your limit or making promises comes back "pending" until a person decides.
 * Poll GET /api/v1/approvals/{id} or pass callback_url to be told the decision.
 */
export async function POST(req: Request) {
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const parsed = ApprovalSchema.safeParse(r.body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  }
  const a = await submitApproval(r.project.id, parsed.data);
  const base = (process.env.APP_URL || "https://proofmyai.com").replace(/\/+$/, "");
  return json({ ...publicApproval(a), poll_url: `${base}/api/v1/approvals/${a.id}` }, 201);
}
