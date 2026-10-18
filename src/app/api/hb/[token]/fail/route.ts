import { json } from "@/lib/api";
import { ping } from "@/lib/heartbeats";
import { rateLimit } from "@/lib/security";

/** The job reports its own failure: an alert goes out straight away. */
async function handle(req: Request, token: string) {
  if (!rateLimit(`hb:${token}`, 120, 60000)) return json({ error: "Too many check-ins" }, 429);
  const msg = new URL(req.url).searchParams.get("msg") ?? (req.method === "POST" ? (await req.text().catch(() => "")).slice(0, 500) : "");
  const h = await ping(token, true, msg.trim() ? msg.trim().slice(0, 500) : null);
  return h ? json({ ok: true }) : json({ error: "Unknown heartbeat" }, 404);
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, (await params).token);
}
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, (await params).token);
}
