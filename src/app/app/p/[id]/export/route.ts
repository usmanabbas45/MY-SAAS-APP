import { currentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { exportTrainingJsonl } from "@/lib/ml/risk";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Not logged in", { status: 401 });
  const projectId = Number((await params).id);
  if (!get("SELECT id FROM projects WHERE id = ? AND user_id = ?", projectId, user.id)) return new Response("Not found", { status: 404 });
  return new Response(exportTrainingJsonl(projectId), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="agentproof-training-${projectId}.jsonl"`,
    },
  });
}
