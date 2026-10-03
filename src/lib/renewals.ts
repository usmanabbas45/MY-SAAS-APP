import { PLANS, yearlyPrice, type PlanId } from "./billing";
import { all, run } from "./db";
import { sendMail } from "./email";
import { compose } from "./emails";
import { SITE_URL } from "./seo";

/**
 * Reminder email about 30 days before a yearly plan renews. Auto-renewal laws (for example in California
 * and the EU) expect advance notice for yearly renewals, and it prevents surprise charges and chargebacks.
 * users.renew_reminded_for holds the renewal date already reminded about, so each renewal gets one email.
 */
export const REMIND_DAYS = 30;
/** Free trials (monthly or yearly) get a reminder this many days before the first charge. */
export const TRIAL_REMIND_DAYS = 3;

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function renewalEmail(plan: PlanId, renewsAt: string) {
  const url = `${(process.env.APP_URL || SITE_URL).replace(/\/+$/, "")}/app/billing`;
  const amount = `$${yearlyPrice(plan).toLocaleString("en-US")}`;
  return compose(`Your ProofMyAI ${PLANS[plan].name} plan renews on ${day(renewsAt)}`, `Your yearly plan renews for ${amount} on ${day(renewsAt)}. No action needed to keep it.`, {
    icon: "📅",
    title: "Your yearly plan renews soon",
    paragraphs: [`This is a friendly reminder that your yearly ${PLANS[plan].name} plan renews automatically on ${day(renewsAt)}.`],
    facts: [["Plan", `${PLANS[plan].name} (yearly)`], ["Renews on", day(renewsAt)], ["Amount", `${amount} plus any local tax`]],
    after: [
      "Nothing to do if you'd like to keep it. To switch to monthly billing or turn off auto-renew, open the Billing page before that date.",
      "Changed your mind after renewing? Our 14-day money-back guarantee applies to renewals too.",
    ],
    cta: { label: "Manage my plan", url },
  }, "You're receiving this because you have a yearly ProofMyAI subscription. This is a required service email.");
}

export function trialEndingEmail(plan: PlanId, yearly: boolean, endsAt: string) {
  const url = `${(process.env.APP_URL || SITE_URL).replace(/\/+$/, "")}/app/billing`;
  const amount = `$${(yearly ? yearlyPrice(plan) : PLANS[plan].price).toLocaleString("en-US")}${yearly ? " per year" : " per month"}`;
  return compose(`Your ProofMyAI free trial ends on ${day(endsAt)}`, `Your ${PLANS[plan].name} plan starts on ${day(endsAt)} at ${amount}.`, {
    icon: "⏳",
    title: "Your free trial ends in 3 days",
    paragraphs: [`Your ${PLANS[plan].name} free trial ends on ${day(endsAt)}. After that your plan continues automatically and your card is charged.`],
    facts: [["Plan", `${PLANS[plan].name} (${yearly ? "yearly" : "monthly"})`], ["First charge", day(endsAt)], ["Amount", `${amount} plus any local tax`]],
    after: ["Nothing to do if you'd like to keep it. Not for you? Turn off auto-renew on the Billing page before that date and you won't be charged."],
    cta: { label: "Manage my plan", url },
  }, "You're receiving this because you started a ProofMyAI free trial. This is a required service email.");
}

/** Sends due reminders. Called from the 15-minute cron. */
export async function sendRenewalReminders(now = new Date()): Promise<number> {
  if (!process.env.RESEND_API_KEY) return 0;
  const until = new Date(now.getTime() + REMIND_DAYS * 86400000).toISOString();
  const due = all<{ id: number; email: string; plan: string; plan_renews_at: string }>(
    `SELECT id, email, plan, plan_renews_at FROM users
      WHERE plan_interval = 'year' AND plan_status = 'active' AND plan_cancel_at IS NULL
        AND plan_renews_at IS NOT NULL AND plan_renews_at > ? AND plan_renews_at <= ?
        AND (renew_reminded_for IS NULL OR renew_reminded_for <> plan_renews_at)`,
    now.toISOString(), until,
  );
  let sent = 0;
  const trialUntil = new Date(now.getTime() + TRIAL_REMIND_DAYS * 86400000).toISOString();
  const trials = all<{ id: number; email: string; plan: string; plan_interval: string; ends: string }>(
    `SELECT id, email, plan, plan_interval, COALESCE(trial_ends_at, plan_renews_at) AS ends FROM users
      WHERE plan_status = 'trialing' AND plan_cancel_at IS NULL AND COALESCE(trial_ends_at, plan_renews_at) > ?
        AND COALESCE(trial_ends_at, plan_renews_at) <= ? AND (renew_reminded_for IS NULL OR renew_reminded_for <> COALESCE(trial_ends_at, plan_renews_at))`,
    now.toISOString(), trialUntil,
  );
  for (const u of trials) {
    if (!(u.plan in PLANS) || u.plan === "free") continue;
    try {
      await sendMail(u.email, trialEndingEmail(u.plan as PlanId, u.plan_interval === "year", u.ends));
      run("UPDATE users SET renew_reminded_for = ? WHERE id = ?", u.ends, u.id);
      sent++;
    } catch (err) {
      console.error(`[renewals] trial user ${u.id}:`, err instanceof Error ? err.message : err);
    }
  }
  for (const u of due) {
    if (!(u.plan in PLANS) || u.plan === "free") continue;
    try {
      await sendMail(u.email, renewalEmail(u.plan as PlanId, u.plan_renews_at));
      run("UPDATE users SET renew_reminded_for = ? WHERE id = ?", u.plan_renews_at, u.id);
      sent++;
    } catch (err) {
      console.error(`[renewals] user ${u.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}
