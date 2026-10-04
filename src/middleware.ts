import { NextResponse, type NextRequest } from "next/server";

const REF_COOKIE = "pm_ref";

/**
 * - Sends www.proofmyai.com (and any www. host) and the *.up.railway.app address to the main domain with a
 *   permanent redirect, so Google sees one site.
 * - Remembers a referral code (?ref=abcd2345) for 60 days, so the friend is credited when they sign up later.
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  // The Railway preview address (*.up.railway.app) serves the same pages. Send it to the real domain so Google
  // never indexes a duplicate copy of the site. API calls are excluded by the matcher below.
  const canonical = (() => { try { return new URL(process.env.APP_URL ?? "").host.toLowerCase(); } catch { return ""; } })();
  if (host.endsWith(".up.railway.app") && canonical && !canonical.endsWith(".up.railway.app") && host !== canonical) {
    return NextResponse.redirect(new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${canonical}`), 308);
  }
  if (host.startsWith("www.")) {
    const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${host.slice(4)}`);
    return NextResponse.redirect(url, 308);
  }
  const ref = req.nextUrl.searchParams.get("ref")?.toLowerCase();
  const res = NextResponse.next();
  if (ref && /^[a-z0-9]{8}$/.test(ref) && !req.cookies.get(REF_COOKIE)) {
    // First invite wins: a later link doesn't replace the friend who invited them first.
    res.cookies.set(REF_COOKIE, ref, { maxAge: 60 * 86400, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/" });
  }
  return res;
}

export const config = {
  // Skip static files; API webhooks never use www.
  matcher: ["/((?!_next/static|_next/image|api/).*)"],
};
