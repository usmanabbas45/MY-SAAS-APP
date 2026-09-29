import { get, all, run } from "./db";
import { sendMail } from "./email";
import { FOUNDING_OFFER } from "./testimonials";

/**
 * Founding-customer offer, fully automatic: a signed-in user claims a spot and immediately gets the
 * offer plan for FOUNDING_OFFER.days. A reminder goes out 7 days before the end, and the cron moves the
 * account back to Free when the period ends (unless they started a paid subscription in the meantime).
 */

export function foundingSpotsLeft(): number {
  const used = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE founding_at IS NOT NULL")?.n ?? 0;
  return Math.max(0, FOUNDING_OFFER.spots - used);
}

export function foundingStatus(userId: number): { claimed: boolean; endsAt: string | null; active: boolean } {
  const u = get<{ founding_at: string | null; comp_ends_at: string | null; plan_status: string | null }>("SELECT founding_at, comp_ends_at, plan_status FROM users WHERE id = ?", userId);
  return { claimed: Boolean(u?.founding_at), endsAt: u?.comp_ends_at ?? null, active: Boolean(u?.founding_at && u.plan_status === "comped" && u.comp_ends_at) };
}

export type ClaimResult = { ok: true; endsAt: string } | { ok: false; error: string };

export async function claimFoundingSpot(userId: number, now = new Date()): Promise<ClaimResult> {
  const u = get<{ email: string; founding_at: string | null; plan_status: string | null }>("SELECT email, founding_at, plan_status FROM users WHERE id = ?", userId);
  if (!u) return { ok: false, error: "Account not found." };
  if (u.founding_at) return { ok: false, error: "You already claimed your founding spot." };
  if (["active", "trialing", "past_due"].includes(u.plan_status ?? "")) return { ok: false, error: "You already have a paid plan, so the founding offer doesn't apply. Thank you for supporting ProofMyAI!" };
  if (foundingSpotsLeft() <= 0) return { ok: false, error: "All founding spots are taken. You can still start free or take a 14-day trial." };
  const endsAt = new Date(now.getTime() + FOUNDING_OFFER.days * 86400000).toISOString();
  // Conditional update so two simultaneous claims can't exceed the number of spots.
  const res = run(
    `UPDATE users SET plan = ?, plan_status = 'comped', founding_at = ?, comp_ends_at = ?, comp_reminded_at = NULL, plan_cancel_at = NULL, trial_ends_at = NULL
     WHERE id = ? AND founding_at IS NULL AND (SELECT COUNT(*) FROM users WHERE founding_at IS NOT NULL) < ?`,
    FOUNDING_OFFER.plan, now.toISOString(), endsAt, userId, FOUNDING_OFFER.spots,
  );
  if (!res.changes) return { ok: false, error: "All founding spots are taken. You can still start free or take a 14-day trial." };
  const { foundingWelcomeEmail } = await import("./emails");
  const mail = foundingWelcomeEmail(endsAt);
  await sendMail(u.email, mail).catch(() => false);
  return { ok: true, endsAt };
}

/** Called by the cron: reminders 7 days before the end, then back to Free. Returns how many ended. */
export async function processFoundingPeriods(now = new Date()): Promise<{ reminded: number; ended: number }> {
  const { foundingEndingEmail, foundingEndedEmail } = await import("./emails");
  const soon = new Date(now.getTime() + 7 * 86400000).toISOString();
  let reminded = 0;
  for (const u of all<{ id: number; email: string; comp_ends_at: string }>(
    "SELECT id, email, comp_ends_at FROM users WHERE plan_status = 'comped' AND comp_ends_at IS NOT NULL AND comp_ends_at <= ? AND comp_ends_at > ? AND comp_reminded_at IS NULL", soon, now.toISOString(),
  )) {
    run("UPDATE users SET comp_reminded_at = ? WHERE id = ?", now.toISOString(), u.id);
    const mail = foundingEndingEmail(u.comp_ends_at);
    await sendMail(u.email, mail).catch(() => false);
    reminded++;
  }
  let ended = 0;
  for (const u of all<{ id: number; email: string }>(
    "SELECT id, email FROM users WHERE plan_status = 'comped' AND comp_ends_at IS NOT NULL AND comp_ends_at <= ?", now.toISOString(),
  )) {
    run("UPDATE users SET plan = 'free', plan_status = NULL, comp_ends_at = NULL, plan_updated_at = ? WHERE id = ?", now.toISOString(), u.id);
    const mail = foundingEndedEmail();
    await sendMail(u.email, mail).catch(() => false);
    ended++;
  }
  return { reminded, ended };
}
