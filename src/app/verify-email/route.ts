import { confirmEmail } from "@/lib/verify";

export const dynamic = "force-dynamic";

/** Link from the confirmation email. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.APP_URL?.replace(/\/+$/, "") || url.origin;
  const ok = confirmEmail(url.searchParams.get("token") ?? "");
  const msg = ok
    ? "ok=" + encodeURIComponent("✅ Email confirmed. Alerts and team invitations are switched on.")
    : "error=" + encodeURIComponent("That confirmation link has expired or was already used. Log in and click \"Resend link\" to get a new one.");
  return Response.redirect(`${base}/app/account?${msg}`, 303);
}
