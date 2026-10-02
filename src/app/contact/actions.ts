"use server";

import { headers } from "next/headers";
import { sendMail } from "@/lib/email";
import { internalEmail } from "@/lib/emails";
import { rateLimit } from "@/lib/security";
import { SUPPORT_EMAIL } from "@/lib/seo";

export interface ContactState { ok?: string; error?: string }

export async function contactAction(_: ContactState, form: FormData): Promise<ContactState> {
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  const email = String(form.get("email") ?? "").trim().slice(0, 200);
  const message = String(form.get("message") ?? "").trim().slice(0, 5000);
  if (String(form.get("website") ?? "")) return { ok: "Thanks! We'll reply soon." }; // honeypot for bots
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email so we can reply." };
  if (message.length < 10) return { error: "Please write a little more (at least 10 characters)." };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`contact:${ip}`, 5, 3600000)) return { error: "Too many messages. Please try again later or email us directly." };
  try {
    const sent = await sendMail(SUPPORT_EMAIL, internalEmail(`[ProofMyAI contact] ${name || email}`, "New contact form message", [["👤 From", `${name} <${email}>`.trim()]], message), { replyTo: email });
    if (!sent) return { error: `Our contact form is not connected yet. Please email ${SUPPORT_EMAIL} directly.` };
  } catch {
    return { error: `We couldn't send your message. Please email ${SUPPORT_EMAIL} directly.` };
  }
  return { ok: "Thanks! Your message was sent. We usually reply within one business day." };
}
