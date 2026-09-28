import { NextResponse, type NextRequest } from "next/server";

/** Sends www.proofmyai.com (and any www. host) to the main domain with a permanent redirect, so Google sees one site. */
export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!host.startsWith("www.")) return NextResponse.next();
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${host.slice(4)}`);
  return NextResponse.redirect(url, 308);
}

export const config = {
  // Skip static files; API webhooks never use www.
  matcher: ["/((?!_next/static|_next/image|api/).*)"],
};
