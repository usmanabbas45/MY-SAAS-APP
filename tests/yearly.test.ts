import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applySubscription, billingConfigProblems, billingState, changePlan, checkoutSignature, priceId, priceInfo, yearlyAvailable, yearlyMonthly, yearlyPrice, type PaddleSubscription,
} from "@/lib/billing";
import { adminStats } from "@/lib/admin";
import { run } from "@/lib/db";
import { freshDb } from "./helpers";

const ENV = {
  PADDLE_ENV: "sandbox",
  PADDLE_API_KEY: "pdl_sdbx_apikey_abc",
  PADDLE_CLIENT_TOKEN: "test_abc123",
  PADDLE_WEBHOOK_SECRET: "pdl_ntfset_secret",
  PADDLE_PRICE_STARTER: "pri_starter",
  PADDLE_PRICE_GROWTH: "pri_growth",
  PADDLE_PRICE_AGENCY: "pri_agency",
};
let userId: number;
const sub = (price: string, over: Partial<PaddleSubscription> = {}): PaddleSubscription => ({
  id: "sub_1", status: "active", customer_id: "ctm_1", custom_data: { user_id: String(userId), sig: checkoutSignature(userId) },
  items: [{ price: { id: price } }], next_billed_at: "2027-10-03T00:00:00Z", updated_at: "2026-10-03T10:00:00Z", ...over,
});
beforeEach(() => {
  Object.assign(process.env, ENV);
  ({ userId } = freshDb());
});
afterEach(() => {
  for (const k of [...Object.keys(ENV), "PADDLE_PRICE_GROWTH_YEARLY", "PADDLE_PRICE_STARTER_YEARLY"]) delete process.env[k];
});

describe("yearly plans", () => {
  it("are off until a yearly price is configured", () => {
    expect(yearlyAvailable()).toBe(false);
    process.env.PADDLE_PRICE_GROWTH_YEARLY = "pri_growth_y";
    expect(yearlyAvailable()).toBe(true);
    expect(priceId("growth", "year")).toBe("pri_growth_y");
    expect(priceId("starter", "year")).toBe("");
    process.env.PADDLE_PRICE_STARTER_YEARLY = "pro_wrong";
    expect(billingConfigProblems()).toContain("PADDLE_PRICE_STARTER_YEARLY should be a price ID starting with pri_ (not the product ID pro_).");
  });

  it("cost 10 months for 12", () => {
    expect(yearlyPrice("growth")).toBe(790);
    expect(yearlyMonthly("growth")).toBe(65);
    expect(yearlyPrice("starter")).toBe(290);
    expect(yearlyMonthly("starter")).toBe(24);
  });

  it("webhooks store the billing period, and MRR spreads yearly over 12 months", () => {
    process.env.PADDLE_PRICE_GROWTH_YEARLY = "pri_growth_y";
    expect(priceInfo("pri_growth_y")).toEqual({ plan: "growth", interval: "year" });
    expect(priceInfo("pri_growth")).toEqual({ plan: "growth", interval: "month" });
    applySubscription(sub("pri_growth_y"));
    expect(billingState(userId)).toMatchObject({ plan: { id: "growth" }, interval: "year" });
    const other = run("INSERT INTO users (email, password_hash, plan, plan_status) VALUES ('m@x.com', 'x', 'growth', 'active')").lastInsertRowid;
    expect(billingState(other).interval).toBe("month");
    const s = adminStats();
    expect(s.byPlan.find((p) => p.plan === "growth")).toMatchObject({ paying: 2, yearly: 1 });
    expect(s.mrr).toBe(79 + Math.round(790 / 12));
  });

  it("switching to yearly sends the yearly price to Paddle", async () => {
    process.env.PADDLE_PRICE_GROWTH_YEARLY = "pri_growth_y";
    applySubscription(sub("pri_growth"));
    const bodies: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return Response.json({ data: sub("pri_growth_y", { updated_at: "2026-10-03T11:00:00Z" }) });
    }) as typeof fetch;
    try {
      await changePlan(userId, "growth", "year");
      expect(JSON.parse(bodies[0]).items).toEqual([{ price_id: "pri_growth_y", quantity: 1 }]);
      expect(billingState(userId).interval).toBe("year");
      // agency has no yearly price: asking for yearly fails clearly, an upgrade without a period falls back to monthly
      await expect(changePlan(userId, "agency", "year")).rejects.toThrow(/isn't available yearly/);
      await changePlan(userId, "growth");
      expect(JSON.parse(bodies[1]).items).toEqual([{ price_id: "pri_growth_y", quantity: 1 }]); // keeps yearly
      process.env.PADDLE_PRICE_GROWTH_YEARLY = "";
      await changePlan(userId, "agency");
      expect(JSON.parse(bodies[2]).items).toEqual([{ price_id: "pri_agency", quantity: 1 }]);
    } finally {
      globalThis.fetch = real;
    }
  });
});
