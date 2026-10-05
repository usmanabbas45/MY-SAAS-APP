"use server";

import { cookies, headers } from "next/headers";
import { sendMail } from "@/lib/email";
import { internalEmail } from "@/lib/emails";
import { currentGaIds, trackEvent } from "@/lib/ga";
import { rateLimit } from "@/lib/security";
import { captchaConfig, checkCaptcha, type CaptchaConfig } from "@/lib/captcha";
import { isDisposableEmail } from "@/lib/disposable";
import { adminEmails } from "@/lib/admin";
import { SITE_URL, SUPPORT_EMAIL } from "@/lib/seo";
import { ATTR_COOKIE, parseAttribution, type Attribution } from "@/lib/attribution";
import { addLead, recentLeadExists } from "@/lib/leads";
import { PLATFORMS } from "./platforms";

export interface AuditState { ok?: boolean; error?: string; captcha?: CaptchaConfig }


const fail = (error: string): AuditState => ({ error, captcha: captchaConfig() });

export async function requestAuditAction(_: AuditState, form: FormData): Promise<AuditState> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const email = String(form.get("email") ?? "").trim().slice(0, 200);
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  let website = String(form.get("site") ?? "").trim().slice(0, 300);
  const platform = String(form.get("platform") ?? "");
  const message = String(form.get("message") ?? "").trim().slice(0, 2000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email so we can send your audit.");
  if (isDisposableEmail(email)) return fail("Please use your work email, so we can send the report.");
  if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
  try {
    const u = new URL(website);
    if (!u.hostname.includes(".")) throw new Error("no tld");
    website = u.origin + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return fail("Enter your website address, for example yourshop.com.");
  }
  if (!PLATFORMS.includes(platform)) return fail("Choose which chatbot or automation you use.");
  if (!rateLimit(`audit-req:${ip}`, 5, 3600000)) return fail("Too many requests from your network. Please try again later.");
  const bot = await checkCaptcha(form, ip);
  if (bot) return fail(bot);
  if (recentLeadExists(email)) return { ok: true }; // already asked today: don't create a duplicate

  // UTM tags on the link win (outreach links), then the first-visit cookie.
  const fromLink: Attribution | null = form.get("utm_source")
    ? { source: String(form.get("utm_source")).slice(0, 80), medium: String(form.get("utm_medium") ?? "").slice(0, 80) || null, campaign: String(form.get("utm_campaign") ?? "").slice(0, 80) || null, referrer: null, landing: "/free-audit" }
    : null;
  const attr = parseAttribution(fromLink ? new URLSearchParams({ s: fromLink.source ?? "", m: fromLink.medium ?? "", c: fromLink.campaign ?? "", l: "/free-audit" }).toString() : (await cookies()).get(ATTR_COOKIE)?.value);
  addLead({ kind: "audit_request", email, name, website, platform, message }, attr);

  const to = adminEmails()[0] ?? SUPPORT_EMAIL;
  try {
    await sendMail(to, internalEmail(`[ProofMyAI lead] Free audit: ${website}`, "New free audit request", [
      ["👤 From", `${name} <${email}>`.trim()], ["🌐 Website", website], ["🤖 Uses", platform], ["📣 Came from", attr?.source ?? attr?.referrer ?? "direct / unknown"],
    ], message || "(no message)", { label: "Open leads", url: `${SITE_URL}/app/admin/leads` }), { replyTo: email });
  } catch (err) {
    console.error("[free-audit] notification failed:", err); // the lead is saved; it shows in the admin
  }
  void trackEvent(await currentGaIds(), "generate_lead", { form: "free_audit" });
  return { ok: true };
}
