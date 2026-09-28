import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySubscription, checkoutSignature } from "@/lib/billing";
import { parseGaCookies, rememberGaClient, trackEvent } from "@/lib/ga";
import { freshDb } from "./helpers";

let userId: number;
const sent: { url: string; body: { client_id: string; events: { name: string; params: Record<string, unknown> }[] } }[] = [];
const real = globalThis.fetch;

beforeEach(() => {
  sent.length = 0;
  Object.assign(process.env, { GA_MEASUREMENT_ID: "G-VM2RLFXS1Y", GA_API_SECRET: "sec", PADDLE_API_KEY: "pdl_sdbx_apikey_x", PADDLE_CLIENT_TOKEN: "test_x", PADDLE_PRICE_GROWTH: "pri_g" });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  ({ userId } = freshDb());
});
afterEach(() => {
  globalThis.fetch = real;
  for (const k of ["GA_MEASUREMENT_ID", "GA_API_SECRET", "PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_PRICE_GROWTH"]) delete process.env[k];
});

describe("conversion tracking", () => {
  it("reads client and session IDs from both GA cookie formats", () => {
    expect(parseGaCookies([{ name: "_ga", value: "GA1.1.123456789.1727500000" }, { name: "_ga_VM2RLFXS1Y", value: "GS1.1.1727501234.3.1.1727501300.0.0.0" }]))
      .toEqual({ clientId: "123456789.1727500000", sessionId: "1727501234" });
    expect(parseGaCookies([{ name: "_ga", value: "GA1.1.1.2" }, { name: "_ga_VM2RLFXS1Y", value: "GS2.1.s1727509999$o5$g1$t1727510000" }])?.sessionId).toBe("1727509999");
    expect(parseGaCookies([{ name: "_ga", value: "garbage" }])).toBeNull();
  });

  it("sends events through the Measurement Protocol only when configured", async () => {
    expect(await trackEvent({ clientId: "1.2", sessionId: "99" }, "sign_up", { method: "email" })).toBe(true);
    expect(sent[0].url).toBe("https://www.google-analytics.com/mp/collect?measurement_id=G-VM2RLFXS1Y&api_secret=sec");
    expect(sent[0].body).toMatchObject({ client_id: "1.2", events: [{ name: "sign_up", params: { method: "email", session_id: "99", engagement_time_msec: 1 } }] });
    delete process.env.GA_API_SECRET;
    expect(await trackEvent({ clientId: "1.2" }, "sign_up")).toBe(false);
    expect(await trackEvent(null, "sign_up")).toBe(false);
  });

  it("tracks trial start and first payment once each, credited to the visitor who signed up", async () => {
    rememberGaClient(userId, { clientId: "555.666" });
    const sub = (status: string, t: string) => ({ id: "sub_1", status, customer_id: "c", custom_data: { user_id: String(userId), sig: checkoutSignature(userId) }, items: [{ price: { id: "pri_g" } }], next_billed_at: "2026-10-12T00:00:00Z", updated_at: t });
    applySubscription(sub("trialing", "2026-09-28T10:00:00Z"));
    applySubscription(sub("trialing", "2026-09-28T10:00:01Z")); // webhook + checkout sync: no duplicate
    applySubscription(sub("active", "2026-10-12T00:00:00Z"));
    applySubscription(sub("active", "2026-10-12T00:00:01Z"));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent.map((s) => s.body.events[0].name)).toEqual(["begin_trial", "purchase"]);
    expect(sent[1].body).toMatchObject({ client_id: "555.666", events: [{ params: { value: 79, currency: "USD", plan: "growth" } }] });
  });
});
