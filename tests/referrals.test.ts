import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string }[] = [];
vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async (to: string, mail: { subject: string }) => { sent.push({ to, subject: mail.subject }); return true; }),
  fromAddress: () => "ProofMyAI <alerts@proofmyai.com>",
}));

import { applySubscription, checkoutSignature, type PaddleSubscription } from "@/lib/billing";
import { get, run } from "@/lib/db";
import { applyPendingRewards, isRefCode, recordReferral, refCode, referralStats } from "@/lib/referrals";
import { freshDb } from "./helpers";

const ENV = { PADDLE_ENV: "sandbox", PADDLE_API_KEY: "pdl_sdbx_apikey_abc", PADDLE_CLIENT_TOKEN: "test_abc123", PADDLE_PRICE_STARTER: "pri_starter", PADDLE_PRICE_GROWTH: "pri_growth", PADDLE_PRICE_AGENCY: "pri_agency", ADMIN_EMAILS: "owner@proofmyai.com" };
let inviter: number, friend: number;
const sub = (userId: number, id: string, price: string, status = "active"): PaddleSubscription => ({
  id, status, customer_id: `ctm_${id}`, custom_data: { user_id: String(userId), sig: checkoutSignature(userId) },
  items: [{ price: { id: price } }], next_billed_at: "2026-11-03T00:00:00Z", updated_at: new Date().toISOString(),
});
beforeEach(() => {
  Object.assign(process.env, ENV);
  ({ userId: inviter } = freshDb());
  friend = run("INSERT INTO users (email, password_hash) VALUES ('friend@shop.com', 'x')").lastInsertRowid;
  sent.length = 0;
});
afterEach(() => { for (const k of Object.keys(ENV)) delete process.env[k]; });

/** Fake Paddle API: records calls; subscriptions keep the discount that was applied. */
function fakePaddle(opts: { failDiscounts?: boolean } = {}) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const discounts = new Map<string, string>();
  let n = 0;
  const api = (async (path: string, init: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: init.method ?? "GET", body: init.body });
    if (path === "/discounts") {
      if (opts.failDiscounts) throw new Error("Paddle: You aren't permitted to perform this request.");
      return { id: `dsc_${++n}` };
    }
    const id = path.split("/")[2];
    if (init.method === "PATCH") discounts.set(id, (init.body as { discount: { id: string } }).discount.id);
    return { id, status: "active", discount: discounts.has(id) ? { id: discounts.get(id) } : null };
  }) as never;
  return { api, calls };
}

describe("referral program", () => {
  it("gives everyone a stable 8-character invite code", () => {
    const c = refCode(inviter);
    expect(isRefCode(c)).toBe(true);
    expect(refCode(inviter)).toBe(c);
    expect(refCode(friend)).not.toBe(c);
  });

  it("credits the inviter at sign-up, but not for unknown codes or self-invites", () => {
    expect(recordReferral(friend, "zzzzzzzz")).toBe(false);
    expect(recordReferral(inviter, refCode(inviter))).toBe(false);
    expect(recordReferral(friend, refCode(inviter))).toBe(true);
    expect(referralStats(inviter).signedUp).toBe(1);
  });

  it("rewards both only when the friend actually pays, and applies one month off the next bill", async () => {
    recordReferral(friend, refCode(inviter));
    applySubscription(sub(friend, "sub_f", "pri_growth", "trialing"));
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM referral_rewards")?.n).toBe(0); // a trial isn't a payment
    applySubscription(sub(friend, "sub_f", "pri_growth", "active"));
    applySubscription(sub(friend, "sub_f", "pri_growth", "active")); // duplicate webhook
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM referral_rewards")?.n).toBe(2);

    const { api, calls } = fakePaddle();
    // the inviter is on the Free plan: their month waits
    expect(await applyPendingRewards(api)).toEqual({ applied: 1, waiting: 1, failed: 0 });
    const disc = calls.find((c) => c.path === "/discounts")!.body as Record<string, unknown>;
    expect(disc).toMatchObject({ type: "flat", amount: "7900", currency_code: "USD", recur: false, usage_limit: 1 });
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ path: "/subscriptions/sub_f", body: { discount: { id: "dsc_1", effective_from: "next_billing_period" } } });
    expect(sent).toEqual([{ to: "friend@shop.com", subject: "🎁 Your next month of ProofMyAI is free" }]);

    applySubscription(sub(inviter, "sub_i", "pri_starter", "active"));
    expect(await applyPendingRewards(api)).toEqual({ applied: 1, waiting: 0, failed: 0 });
    expect(referralStats(inviter)).toMatchObject({ signedUp: 1, paying: 1, applied: 1, pending: 0, savedUsd: 29 });
  });

  it("retries, then asks the admin to apply it by hand after 3 failures", async () => {
    recordReferral(friend, refCode(inviter));
    applySubscription(sub(friend, "sub_f", "pri_growth"));
    const bad = fakePaddle({ failDiscounts: true });
    for (let i = 0; i < 2; i++) expect((await applyPendingRewards(bad.api)).failed).toBe(0);
    expect((await applyPendingRewards(bad.api)).failed).toBe(1);
    expect(sent.some((m) => m.to === "owner@proofmyai.com" && /Referral reward/.test(m.subject))).toBe(true);
  });

  it("caps rewards for the inviter at 12 a year", () => {
    for (let i = 0; i < 13; i++) {
      const f = run("INSERT INTO users (email, password_hash, referred_by) VALUES (?, 'x', ?)", `f${i}@x.com`, inviter).lastInsertRowid;
      applySubscription(sub(f, `sub_${i}`, "pri_starter"));
    }
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM referral_rewards WHERE user_id = ? AND role = 'referrer'", inviter)?.n).toBe(12);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM referral_rewards WHERE role = 'friend'")?.n).toBe(13);
  });
});
