import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminStats, isAdmin, listUsers, setPlanManually, setSuspended, userDetail } from "@/lib/admin";
import { billingState } from "@/lib/billing";
import { get, run } from "@/lib/db";
import { projectFromRequest } from "@/lib/projects";
import { freshDb } from "./helpers";

let userId: number;
const addUser = (email: string, plan = "free", status: string | null = null, createdDaysAgo = 0) =>
  run("INSERT INTO users (email, password_hash, plan, plan_status, created_at) VALUES (?, 'x', ?, ?, datetime('now', ?))", email, plan, status, `-${createdDaysAgo} days`).lastInsertRowid;

beforeEach(() => {
  Object.assign(process.env, { PADDLE_API_KEY: "pdl_sdbx_apikey_x", PADDLE_CLIENT_TOKEN: "test_x", PADDLE_PRICE_GROWTH: "pri_g" });
  ({ userId } = freshDb());
});
afterEach(() => {
  for (const k of ["PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_PRICE_GROWTH", "ADMIN_EMAILS", "UNLIMITED_EMAILS"]) delete process.env[k];
});

describe("admin", () => {
  it("recognises admins from ADMIN_EMAILS, falling back to UNLIMITED_EMAILS", () => {
    expect(isAdmin("t@example.com")).toBe(false);
    process.env.UNLIMITED_EMAILS = "T@example.com";
    expect(isAdmin("t@example.com")).toBe(true);
    process.env.ADMIN_EMAILS = "boss@x.com";
    expect(isAdmin("t@example.com")).toBe(false);
    expect(isAdmin("BOSS@x.com")).toBe(true);
  });

  it("calculates MRR from paying plans only and counts trials, failed payments and sign-ups", () => {
    addUser("a@x.com", "growth", "active");
    addUser("b@x.com", "agency", "past_due");
    addUser("c@x.com", "starter", "trialing");
    addUser("d@x.com", "growth", "canceled");
    addUser("e@x.com", "starter", "comped", 40);
    const s = adminStats();
    expect(s.mrr).toBe(79 + 199);
    expect([s.paying, s.trialing, s.pastDue, s.comped, s.users]).toEqual([2, 1, 1, 1, 6]);
    expect(s.new7).toBe(5);
    expect(s.signups).toHaveLength(30);
    expect(s.signups.at(-1)!.count).toBe(5);
  });

  it("filters users by segment and searches email safely", () => {
    addUser("paying@x.com", "growth", "active");
    addUser("trial@x.com", "growth", "trialing");
    addUser("100%_real@x.com");
    expect(listUsers({ segment: "paying" }).rows.map((r) => r.email)).toEqual(["paying@x.com"]);
    expect(listUsers({ segment: "free" }).total).toBe(2);
    expect(listUsers({ q: "%" }).rows.map((r) => r.email)).toEqual(["100%_real@x.com"]);
    expect(listUsers({ q: "TRIAL" }).total).toBe(1);
  });

  it("gives and removes plans without Paddle", () => {
    setPlanManually(userId, "agency");
    expect(billingState(userId).plan.id).toBe("agency");
    setPlanManually(userId, "free");
    expect(billingState(userId).plan.id).toBe("free");
  });

  it("suspending logs the user out and blocks their API keys", () => {
    run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h', ?, ?)", userId, new Date(Date.now() + 1e9).toISOString());
    const req = () => new Request("http://x", { headers: { authorization: "Bearer ap_live_test" } });
    expect(projectFromRequest(req())).not.toBeNull();
    setSuspended(userId, true);
    expect(get("SELECT 1 FROM sessions WHERE user_id = ?", userId)).toBeUndefined();
    expect(projectFromRequest(req())).toBeNull();
    expect(userDetail(userId)!.user.suspended_at).toBeTruthy();
    setSuspended(userId, false);
    expect(projectFromRequest(req())).not.toBeNull();
  });
});
