import { badKeyResponse, json } from "@/lib/api";
import { projectFromRequest } from "@/lib/projects";
import { publicApproval, type Approval } from "@/lib/approvals";
import { get } from "@/lib/db";

/** The current decision on one approval request. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = projectFromRequest(req);
  if (!project) return badKeyResponse(req, "Missing or invalid API key. Send 'Authorization: Bearer ap_live_...'");
  const a = get<Approval>("SELECT * FROM approvals WHERE id = ? AND project_id = ?", Number((await params).id), project.id);
  if (!a) return json({ error: "Approval not found" }, 404);
  return json(publicApproval(a), 200);
}
