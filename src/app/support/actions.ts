"use server";

import { headers } from "next/headers";
import { currentUser } from "@/lib/auth";
import { currentGaIds, trackEvent } from "@/lib/ga";
import { rateLimit } from "@/lib/security";
import { CATEGORIES, createTicket, validateTicket, whatsappLink, type Category } from "@/lib/support";

export interface TicketState { error?: string; ok?: { code: string; whatsapp: string; signedIn: boolean } }

export async function submitTicketAction(_: TicketState, form: FormData): Promise<TicketState> {
  if (String(form.get("website") ?? "")) return { error: "Please try again." }; // honeypot for bots
  const user = await currentUser();
  const input = {
    email: user?.email ?? String(form.get("email") ?? "").trim(),
    name: String(form.get("name") ?? "").trim(),
    category: String(form.get("category") ?? "") as Category,
    subject: String(form.get("subject") ?? ""),
    message: String(form.get("message") ?? ""),
    page: String(form.get("page") ?? ""),
  };
  const problem = validateTicket(input);
  if (problem) return { error: problem };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`ticket:${user?.id ?? ip}`, 8, 3600000)) return { error: "You've sent several tickets in the last hour. Please wait, or message us on WhatsApp." };
  const t = await createTicket({ userId: user?.id ?? null, ...input, category: input.category in CATEGORIES ? input.category : "question" });
  void trackEvent(await currentGaIds(), "generate_lead", { form: "support", category: input.category });
  return { ok: { code: t.code, whatsapp: whatsappLink(t.whatsapp), signedIn: Boolean(user) } };
}
