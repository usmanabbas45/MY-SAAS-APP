"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { submitTestimonial, validateTestimonial } from "@/lib/testimonials";

export async function feedbackAction(form: FormData) {
  const user = await requireUser();
  const s = (k: string) => String(form.get(k) ?? "");
  const input = {
    name: s("name"), role: s("role"), company: s("company"), website: s("website"),
    quote: s("quote"), result: s("result"), rating: Number(form.get("rating")), consent: form.get("consent") === "1",
  };
  const problem = validateTestimonial(input);
  if (problem) redirect(`/app/feedback?error=${encodeURIComponent(problem)}`);
  if (!rateLimit(`feedback:${user.id}`, 5, 3600_000)) redirect("/app/feedback?error=" + encodeURIComponent("Too many submissions. Try again later."));
  await submitTestimonial(user.id, input);
  redirect("/app/feedback?sent=1");
}

/** Hides the dashboard feedback prompt for 90 days. */
export async function dismissFeedbackPromptAction(form: FormData) {
  await requireUser();
  (await cookies()).set("pma_fb_dismissed", "1", { maxAge: 60 * 60 * 24 * 90, path: "/", httpOnly: true, sameSite: "lax" });
  const back = String(form.get("back") ?? "/app");
  redirect(back.startsWith("/app") ? back : "/app");
}
