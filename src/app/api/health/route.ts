import { get } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  get("SELECT 1");
  return Response.json({ ok: true, time: new Date().toISOString() });
}
