import { projectFromRequest, type Project } from "./projects";
import { rateLimit } from "./security";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Reads a request body but stops at `max` bytes, so a huge or endless upload can't fill the server's
 * memory. Returns null when the body is too large.
 */
export async function readBodyLimited(req: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Answers wrong API keys from the same network with 429 after 30 tries a minute (stops key guessing and floods). */
export function badKeyResponse(req: Request, message: string): Response {
  const limited = !rateLimit(`badkey:${clientIp(req)}`, 30, 60000);
  return limited ? json({ error: "Too many requests with an invalid API key. Try again in a minute." }, 429) : json({ error: message }, 401);
}

/** Authenticates, rate-limits and parses an ingestion request. */
export async function readIngest(req: Request): Promise<{ project: Project; body: unknown } | Response> {
  const project = projectFromRequest(req);
  if (!project) return badKeyResponse(req, "Missing or invalid API key. Send 'Authorization: Bearer ap_live_...'");
  if (!rateLimit(`ingest:${project.id}`, 600, 60000)) return json({ error: "Rate limit exceeded (600 requests/minute)" }, 429);
  const text = await readBodyLimited(req);
  if (text === null) return json({ error: "Payload larger than 2 MB" }, 413);
  try {
    return { project, body: JSON.parse(text) };
  } catch {
    return json({ error: "Body must be valid JSON" }, 400);
  }
}
