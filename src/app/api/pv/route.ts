import { NextResponse } from "next/server";
import { recordPageView } from "@/lib/traffic";
import { rateLimit } from "@/lib/security";

/** Cookie-free page view beacon from public pages. Always answers 204 so it never shows errors to visitors. */
export async function POST(req: Request) {
  const h = req.headers;
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!rateLimit(`pv:${ip}`, 120, 600000)) return new NextResponse(null, { status: 204 });
  try {
    const body = JSON.parse((await req.text()).slice(0, 2000)) as { p?: string; r?: string; u?: string };
    recordPageView({
      path: String(body.p ?? ""), referrer: String(body.r ?? ""), utm: String(body.u ?? ""),
      ip, ua: h.get("user-agent") ?? "", host: (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(":")[0],
    });
  } catch { /* ignore malformed beacons */ }
  return new NextResponse(null, { status: 204 });
}
