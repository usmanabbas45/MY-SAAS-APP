import { all, get, run } from "./db";
import { sendMail } from "./email";
import { SUPPORT_EMAIL } from "./seo";

/**
 * Real customer feedback. Nothing is shown on the website unless the customer ticked the consent box
 * (or, for quotes added by an admin, the admin confirmed they have written permission) AND an admin approved it.
 */
export interface Testimonial {
  id: number;
  user_id: number | null;
  name: string;
  role: string | null;
  company: string | null;
  website: string | null;
  quote: string;
  result: string | null;
  rating: number;
  consent: number;
  source: "in_app" | "manual";
  status: "pending" | "approved" | "hidden";
  created_at: string;
  approved_at: string | null;
}

/** Launch offer shown on the homepage until the first testimonials are approved. Change it here. */
export const FOUNDING_OFFER = {
  spots: 20,
  plan: "growth" as const,
  days: 90,
  reward: "the Growth plan free for 3 months",
  ask: "honest feedback, and a short quote if ProofMyAI helps you",
};

export interface TestimonialInput {
  name: string;
  role?: string;
  company?: string;
  website?: string;
  quote: string;
  result?: string;
  rating: number;
  consent: boolean;
}

const clean = (v: string | undefined, max: number) => (v ?? "").trim().slice(0, max) || null;

export function validateTestimonial(i: TestimonialInput): string | null {
  if (i.name.trim().length < 2) return "Add your name (as it should appear).";
  if (i.quote.trim().length < 20) return "Write at least a sentence (20+ characters) about your experience.";
  if (!(i.rating >= 1 && i.rating <= 5)) return "Choose a rating from 1 to 5.";
  if (i.website && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(i.website.trim())) return "Website must start with https://";
  return null;
}

export async function submitTestimonial(userId: number | null, i: TestimonialInput, source: "in_app" | "manual" = "in_app"): Promise<number> {
  const { lastInsertRowid: id } = run(
    "INSERT INTO testimonials (user_id, name, role, company, website, quote, result, rating, consent, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
    userId, i.name.trim().slice(0, 80), clean(i.role, 80), clean(i.company, 80), clean(i.website, 200),
    i.quote.trim().slice(0, 600), clean(i.result, 160), Math.round(i.rating), i.consent ? 1 : 0, source,
  );
  if (source === "in_app") {
    const { internalEmail } = await import("./emails");
    await sendMail(SUPPORT_EMAIL, internalEmail(
      `[ProofMyAI] New ${i.rating}★ feedback from ${i.name}`, `New ${"★".repeat(i.rating)} feedback`,
      [["👤 From", [i.name, i.role, i.company].filter(Boolean).join(", ")], ["🌐 May publish", i.consent ? "Yes" : "No (private feedback)"]],
      i.quote, { label: "Review feedback", url: `${process.env.APP_URL ?? ""}/app/admin/testimonials` },
    )).catch(() => false);
  }
  return id;
}

/** Only testimonials with consent can be approved for the website. */
export function setTestimonialStatus(id: number, status: "approved" | "hidden" | "pending"): string | null {
  const t = get<Testimonial>("SELECT * FROM testimonials WHERE id = ?", id);
  if (!t) return "Feedback not found.";
  if (status === "approved" && !t.consent) return "This customer did not give permission to publish it. Ask them first, then add it again with permission.";
  run("UPDATE testimonials SET status = ?, approved_at = ? WHERE id = ?", status, status === "approved" ? new Date().toISOString() : null, id);
  return null;
}

export function deleteTestimonial(id: number): void {
  run("DELETE FROM testimonials WHERE id = ?", id);
}

export function publishedTestimonials(limit = 6): Testimonial[] {
  return all<Testimonial>("SELECT * FROM testimonials WHERE status = 'approved' AND consent = 1 ORDER BY approved_at DESC, id DESC LIMIT ?", limit);
}

export function listTestimonials(status?: Testimonial["status"]): Testimonial[] {
  return status
    ? all<Testimonial>("SELECT * FROM testimonials WHERE status = ? ORDER BY id DESC LIMIT 200", status)
    : all<Testimonial>("SELECT * FROM testimonials ORDER BY id DESC LIMIT 200");
}

export function testimonialCounts(): Record<Testimonial["status"], number> {
  const rows = all<{ status: Testimonial["status"]; n: number }>("SELECT status, COUNT(*) AS n FROM testimonials GROUP BY status");
  return { pending: 0, approved: 0, hidden: 0, ...Object.fromEntries(rows.map((r) => [r.status, r.n])) };
}

export function userHasGivenFeedback(userId: number): boolean {
  return Boolean(get("SELECT 1 FROM testimonials WHERE user_id = ?", userId));
}

/** Average rating of published testimonials, only once there are enough to be meaningful. */
export function ratingSummary(min = 3): { avg: number; count: number } | null {
  const r = get<{ avg: number | null; n: number }>("SELECT AVG(rating) AS avg, COUNT(*) AS n FROM testimonials WHERE status = 'approved' AND consent = 1");
  return r && r.n >= min && r.avg ? { avg: r.avg, count: r.n } : null;
}
