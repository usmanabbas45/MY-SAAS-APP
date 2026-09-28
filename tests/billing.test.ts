import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applySubscription, billingConfigProblems, billingState, checkoutSignature, limitError, scheduledIds, usage, verifyWebhook, type PaddleSubscription,
} from "@/lib/billing";
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
let projectId: number;
const sub = (over: Partial<PaddleSubscription> = {}): PaddleSubscription => ({
  id: "sub_1", status: "active", customer_id: "ctm_1",
  custom_data: { user_id: String(userId), sig: checkoutSignature(userId) },
  items: [{ price: { id: "pri_growth" } }], next_billed_at: "2026-10-28T00:00:00Z", updated_at: "2026-09-28T10:00:00Z", ...over,
});
const addConversations = (n: number) => {
  const audit = run("INSERT INTO audits (project_id, name, mode, status) VALUES (?, 'a', 'basic', 'done')", projectId).lastInsertRowid;
  for (let i = 0; i < n; i++) {
    run(`INSERT INTO audit_items (audit_id, conversation_id, turn_index, question, answer, verdict, severity, reason, confidence, features_json, created_at)
         VALUES (?, ?, 0, 'q', 'a', 'grounded', 'ok', 'r', 1, '{}', ?)`, audit, `c${i}`, new Date().toISOString());
  }
};

beforeEach(() => {
  Object.assign(process.env, ENV);
  delete process.env.UNLIMITED_EMAILS;
  ({ userId, projectId } = freshDb());
});
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k];
});

describe("webhook signature", () => {
  const body = '{"event_type":"subscription.updated"}';
  const header = (ts: number, secret = ENV.PADDLE_WEBHOOK_SECRET) => `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex")}`;
  const now = 1_790_000_000;

  it("accepts a valid signature and rejects tampering, wrong secrets and old timestamps", () => {
    expect(verifyWebhook(body, header(now), ENV.PADDLE_WEBHOOK_SECRET, now * 1000)).toBe(true);
    expect(verifyWebhook(body + " ", header(now), ENV.PADDLE_WEBHOOK_SECRET, now * 1000)).toBe(false);
    expect(verifyWebhook(body, header(now, "other"), ENV.PADDLE_WEBHOOK_SECRET, now * 1000)).toBe(false);
    expect(verifyWebhook(body, header(now - 3600), ENV.PADDLE_WEBHOOK_SECRET, now * 1000)).toBe(false);
    expect(verifyWebhook(body, null, ENV.PADDLE_WEBHOOK_SECRET, now * 1000)).toBe(false);
    expect(verifyWebhook(body, "garbage", ENV.PADDLE_WEBHOOK_SECRET, now * 1000)).toBe(false);
    expect(verifyWebhook(body, `ts=${now};h1=${"0".repeat(64)};${header(now).split(";")[1]}`, ENV.PADDLE_WEBHOOK_SECRET, now * 1000)).toBe(true);
  });
});

describe("plans", () => {
  it("is unlimited when Paddle is not configured", () => {
    delete process.env.PADDLE_API_KEY;
    expect(billingState(userId).plan.id).toBe("unlimited");
    expect(limitError(userId, "projects", 50)).toBeNull();
    expect(scheduledIds("bots")).toBeNull();
  });

  it("starts on the free plan and owners listed in UNLIMITED_EMAILS have no limits", () => {
    expect(billingState(userId).plan.id).toBe("free");
    expect(limitError(userId, "projects")).toMatch(/Free plan includes 1 project\(s\)/);
    process.env.UNLIMITED_EMAILS = "someone@x.com, T@example.com";
    expect(billingState(userId).plan.id).toBe("unlimited");
  });

  it("applies subscriptions from webhooks, including trial, cancel and past-due", () => {
    expect(applySubscription(sub({ status: "trialing", items: [{ price: { id: "pri_growth" }, trial_dates: { ends_at: "2026-10-12T00:00:00Z" } }] }))).toBe(userId);
    let s = billingState(userId);
    expect([s.plan.id, s.status, s.trialEndsAt]).toEqual(["growth", "trialing", "2026-10-12T00:00:00Z"]);
    expect(limitError(userId, "projects")).toBeNull();

    applySubscription(sub({ updated_at: "2026-09-29T00:00:00Z", scheduled_change: { action: "cancel", effective_at: "2026-10-28T00:00:00Z" } }));
    expect(billingState(userId).cancelAt).toBe("2026-10-28T00:00:00Z");

    applySubscription(sub({ status: "past_due", updated_at: "2026-09-30T00:00:00Z" }));
    expect(billingState(userId).plan.id).toBe("growth"); // keeps access while Paddle retries

    applySubscription(sub({ status: "canceled", updated_at: "2026-10-28T00:00:00Z" }));
    expect(billingState(userId).plan.id).toBe("free");
  });

  it("ignores out-of-order events and forged or unknown users", () => {
    applySubscription(sub({ updated_at: "2026-09-28T12:00:00Z" }));
    applySubscription(sub({ status: "canceled", updated_at: "2026-09-28T11:00:00Z" }));
    expect(billingState(userId).plan.id).toBe("growth");
    expect(applySubscription(sub({ id: "sub_x", customer_id: "ctm_x", custom_data: { user_id: String(userId), sig: "forged" } }))).toBeNull();
    // a later event without custom data still finds the user through the stored subscription ID
    applySubscription(sub({ custom_data: null, items: [{ price: { id: "pri_agency" } }], updated_at: "2026-09-29T00:00:00Z" }));
    expect(billingState(userId).plan.id).toBe("agency");
  });

  it("an old subscription ending does not cancel a newer active one", () => {
    applySubscription(sub({ id: "sub_new", updated_at: "2026-09-28T12:00:00Z" }));
    applySubscription(sub({ id: "sub_old", status: "canceled", updated_at: "2026-09-28T13:00:00Z" }));
    expect(billingState(userId).plan.id).toBe("growth");
  });
});

describe("limits", () => {
  it("counts conversations per month on every plan, including the free plan", () => {
    addConversations(45);
    run("UPDATE audit_items SET created_at = datetime('now', '-40 days') WHERE conversation_id IN ('c0', 'c1')"); // last month
    expect(usage(userId, billingState(userId).plan).conversations).toBe(43);
    expect(limitError(userId, "conversations", 7)).toBeNull();
    expect(limitError(userId, "conversations", 8)).toMatch(/50 audited conversations per month\. You have 7 left/);
    applySubscription(sub({ items: [{ price: { id: "pri_starter" } }] }));
    expect(limitError(userId, "conversations", 457)).toBeNull();
    expect(limitError(userId, "conversations", 458)).toMatch(/500 audited conversations per month/);
  });

  it("sells the optional Compliance plan only when its price exists", () => {
    expect(billingConfigProblems()).toEqual([]); // no PADDLE_PRICE_COMPLIANCE needed
    process.env.PADDLE_PRICE_COMPLIANCE = "pri_comp";
    applySubscription(sub({ items: [{ price: { id: "pri_comp" } }] }));
    expect(billingState(userId).plan).toMatchObject({ id: "compliance", projects: 10 });
    delete process.env.PADDLE_PRICE_COMPLIANCE;
  });

  it("counts workflows and agents together and keeps only the oldest allowed items running", () => {
    for (let i = 0; i < 3; i++) run("INSERT INTO workflow_sources (project_id, platform, name, base_url, api_key_enc) VALUES (?, 'n8n', 'w', 'https://x', 'k')", projectId);
    expect(limitError(userId, "monitors")).toMatch(/2 workflows and AI agents/);
    const kept = scheduledIds("sources")!;
    expect(kept.size).toBe(2);
    applySubscription(sub());
    expect(limitError(userId, "monitors")).toBeNull();
    expect(scheduledIds("sources")!.size).toBe(3);
  });

  it("reports setup mistakes such as placeholder text and product IDs", () => {
    expect(billingConfigProblems()).toEqual([]);
    process.env.PADDLE_API_KEY = "the API key from step 4.4";
    process.env.PADDLE_PRICE_GROWTH = "pro_123";
    process.env.PADDLE_CLIENT_TOKEN = "live_abc";
    const p = billingConfigProblems().join("\n");
    expect(p).toMatch(/PADDLE_API_KEY does not look like/);
    expect(p).toMatch(/PADDLE_PRICE_GROWTH should be a price ID/);
    expect(p).toMatch(/live token but PADDLE_ENV is sandbox/);
  });
});
