import { ingestAgentRun } from "@/lib/agents/ingest";
import { json, readIngest } from "@/lib/api";

export async function POST(req: Request) {
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const result = await ingestAgentRun(r.project.id, r.body);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ id: result.id, score: result.score, issues: result.issues }, 201);
}
