import { json } from "@/lib/api";
import { ping } from "@/lib/heartbeats";
import { rateLimit } from "@/lib/security";

/** Heartbeat check-in: call this URL (GET or POST) when your job finishes. No API key needed: the URL is the secret. */
async function handle(req: Request, token: string, failed: boolean) {
  if (!rateLimit(`hb:${token}`, 120, 60000)) return json({ error: "Too many check-ins" }, 429);
  const msg = new URL(req.url).searchParams.get("msg") ?? (req.method === "POST" ? (await req.text().catch(() => "")).slice(0, 500) : "");
  const h = await ping(token, failed, msg.trim() ? msg.trim().slice(0, 500) : null);
  return h ? json({ ok: true }) : json({ error: "Unknown heartbeat" }, 404);
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, (await params).token, false);
}
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, (await params).token, false);
}
