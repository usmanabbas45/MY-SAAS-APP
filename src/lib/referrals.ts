import crypto from "node:crypto";
import { billingEnabled, billingState, paddleApi, PLANS, type PlanId } from "./billing";
import { all, get, run } from "./db";
import { sendMail } from "./email";
import { compose, systemEmail } from "./emails";
import { emailAdmins } from "./monitoring";
import { SITE_URL } from "./seo";
export { MAX_PER_YEAR, onFriendPaid } from "./referral-rewards";

/**
 * Referral program: "Give a friend a month free, get a month free."
 * - Everyone has an invite link (proofmyai.com/?ref=CODE). The middleware keeps the code in a cookie for
 *   60 days, and sign-up records who invited the new account.
 * - When the friend becomes a paying customer (first real payment, not a trial), both get one month of
 *   their own plan free: a one-time Paddle discount worth one month, applied to their next bill (for yearly
 *   plans, one month's price off the renewal).
 * - Rewards wait as "pending" until the person has a paid subscription, then the 15-minute cron applies them.
 * Only real payments trigger rewards, so fake sign-ups earn nothing. At most MAX_PER_YEAR rewards per inviter.
 */
export const COOKIE = "pm_ref";
const MAX_ATTEMPTS = 3;
const CODE_RE = /^[a-z0-9]{8}$/;

const appUrl = () => (process.env.APP_URL || SITE_URL).replace(/\/+$/, "");

export function isRefCode(v: string | null | undefined): v is string {
  return Boolean(v && CODE_RE.test(v));
}

/** The user's invite code (created on first use). */
export function refCode(userId: number): string {
  const existing = get<{ c: string | null }>("SELECT ref_code AS c FROM users WHERE id = ?", userId)?.c;
  if (existing) return existing;
  for (;;) {
    const code = Array.from(crypto.randomBytes(8), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
    try {
      run("UPDATE users SET ref_code = ? WHERE id = ? AND ref_code IS NULL", code, userId);
      return get<{ c: string }>("SELECT ref_code AS c FROM users WHERE id = ?", userId)!.c;
    } catch {
      // code taken by someone else: try another
    }
  }
}

export const refLink = (userId: number) => `${appUrl()}/?ref=${refCode(userId)}`;

/** Records the inviter of a brand-new account (ignores unknown codes and self-invites). */
export function recordReferral(newUserId: number, code: string | undefined): boolean {
  if (!isRefCode(code)) return false;
  const inviter = get<{ id: number; email: string }>("SELECT id, email FROM users WHERE ref_code = ?", code);
  if (!inviter || inviter.id === newUserId) return false;
  return run("UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL", inviter.id, newUserId).changes > 0;
}

interface Sub { id: string; status: string; discount?: { id?: string } | null }

/** Applies pending rewards to people who have an active paid subscription. Called from the cron. */
export async function applyPendingRewards(api: typeof paddleApi = paddleApi): Promise<{ applied: number; waiting: number; failed: number }> {
  const out = { applied: 0, waiting: 0, failed: 0 };
  if (!billingEnabled()) return out;
  const pending = all<{ id: number; user_id: number; role: string; email: string }>(
    "SELECT r.id, r.user_id, r.role, u.email FROM referral_rewards r JOIN users u ON u.id = r.user_id WHERE r.status = 'pending' ORDER BY r.id",
  );
  const busy = new Set<number>(); // one reward per person per run (a subscription holds one discount at a time)
  for (const r of pending) {
    const state = billingState(r.user_id);
    const plan = state.plan.id;
    if (busy.has(r.user_id) || !state.subscriptionId || !["active", "trialing", "past_due"].includes(state.status ?? "") || !(plan in PLANS) || plan === "free") {
      out.waiting++;
      continue;
    }
    busy.add(r.user_id);
    try {
      const sub = await api<Sub>(`/subscriptions/${state.subscriptionId}`);
      if (sub.discount?.id) { out.waiting++; continue; } // an earlier reward hasn't been used yet
      const cents = PLANS[plan as PlanId].price * 100;
      const discount = await api<{ id: string }>("/discounts", {
        method: "POST",
        body: { description: `Referral reward: 1 month of ${PLANS[plan as PlanId].name} free`, type: "flat", amount: String(cents), currency_code: "USD", recur: false, usage_limit: 1, enabled_for_checkout: false },
      });
      await api(`/subscriptions/${state.subscriptionId}`, { method: "PATCH", body: { discount: { id: discount.id, effective_from: "next_billing_period" } } });
      run("UPDATE referral_rewards SET status = 'applied', amount_cents = ?, discount_id = ?, error = NULL, applied_at = datetime('now') WHERE id = ?", cents, discount.id, r.id);
      out.applied++;
      await sendMail(r.email, rewardEmail(r.role === "friend", PLANS[plan as PlanId].name, PLANS[plan as PlanId].price)).catch(() => false);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      run("UPDATE referral_rewards SET error = ?, attempts = attempts + 1 WHERE id = ?", msg, r.id);
      const tries = get<{ a: number }>("SELECT attempts AS a FROM referral_rewards WHERE id = ?", r.id)?.a ?? 0;
      if (tries >= MAX_ATTEMPTS) {
        run("UPDATE referral_rewards SET status = 'failed' WHERE id = ?", r.id);
        out.failed++;
        await emailAdmins(systemEmail("🎁 Referral reward needs a hand · ProofMyAI", {
          icon: "🎁", tone: "bad", title: "A referral reward couldn't be applied automatically",
          paragraphs: [`ProofMyAI couldn't give ${r.email} their free month in Paddle: ${msg}`, "Usual fix: in Paddle → Developer Tools → Authentication, give the API key permission to write Discounts. Or apply it by hand: Paddle → Customers → this customer → subscription → Add discount (one month of their plan)."],
        }));
      } else out.waiting++;
    }
  }
  return out;
}

export function rewardEmail(friend: boolean, planName: string, price: number) {
  return compose(`🎁 Your next month of ProofMyAI is free`, `$${price} off your next bill, thanks to ${friend ? "joining through a friend" : "a friend you invited"}.`, {
    icon: "🎁",
    title: "Your next month is on us",
    paragraphs: [friend
      ? "Thanks for joining ProofMyAI through a friend's invite. As promised, your next month is free."
      : "A friend you invited just became a ProofMyAI customer. Thank you! Your next month is free."],
    facts: [["Reward", `1 month of ${planName} ($${price})`], ["Applied to", "Your next bill"]],
    after: ["Invite more friends from the “Invite & earn” page in your dashboard: every friend who becomes a customer gives you another free month."],
    cta: { label: "Invite more friends", url: `${appUrl()}/app/referrals` },
  }, "You're receiving this because you're part of the ProofMyAI referral program.");
}

export interface ReferralStats { signedUp: number; paying: number; applied: number; pending: number; savedUsd: number }

export function referralStats(userId: number): ReferralStats {
  const n = (sql: string) => get<{ n: number }>(sql, userId)?.n ?? 0;
  return {
    signedUp: n("SELECT COUNT(*) AS n FROM users WHERE referred_by = ?"),
    paying: n("SELECT COUNT(*) AS n FROM referral_rewards WHERE user_id = ? AND role = 'referrer'"),
    applied: n("SELECT COUNT(*) AS n FROM referral_rewards WHERE user_id = ? AND status = 'applied'"),
    pending: n("SELECT COUNT(*) AS n FROM referral_rewards WHERE user_id = ? AND status IN ('pending', 'failed')"),
    savedUsd: n("SELECT COALESCE(SUM(amount_cents), 0) / 100 AS n FROM referral_rewards WHERE user_id = ? AND status = 'applied'"),
  };
}
