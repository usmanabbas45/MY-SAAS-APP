import { projectFromRequest, type Project } from "./projects";
import { rateLimit } from "./security";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Authenticates, rate-limits and parses an ingestion request. */
export async function readIngest(req: Request): Promise<{ project: Project; body: unknown } | Response> {
  const project = projectFromRequest(req);
  if (!project) return json({ error: "Missing or invalid API key. Send 'Authorization: Bearer ap_live_...'" }, 401);
  if (!rateLimit(`ingest:${project.id}`, 600, 60000)) return json({ error: "Rate limit exceeded (600 requests/minute)" }, 429);
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Payload larger than 2 MB" }, 413);
  try {
    return { project, body: JSON.parse(text) };
  } catch {
    return json({ error: "Body must be valid JSON" }, 400);
  }
}
