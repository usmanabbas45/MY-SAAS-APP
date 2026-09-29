import { beforeEach, describe, expect, it } from "vitest";
import { alertEmail, digestEmail, passwordResetEmail, ticketReplyEmail } from "@/lib/emails";
import { claimFoundingSpot, foundingSpotsLeft, foundingStatus, processFoundingPeriods } from "@/lib/founding";
import { billingState } from "@/lib/billing";
import { get, run } from "@/lib/db";
import { FOUNDING_OFFER } from "@/lib/testimonials";
import { freshDb } from "./helpers";

let userId: number;
beforeEach(() => {
  ({ userId } = freshDb());
  Object.assign(process.env, { PADDLE_API_KEY: "pdl_sdbx_apikey_x", PADDLE_CLIENT_TOKEN: "test_x", PADDLE_PRICE_GROWTH: "pri_g" });
});

const alert = { projectName: "Demo", kind: "problem" as const, module: "chatbot", code: "NO_REPLY", severity: "high" as const, title: "Your bot did not reply to 1 customer message", detail: "Oldest has waited 7 min.", link: "https://proofmyai.com/app/p/3/incidents" };

describe("email templates", () => {
  it("alert email has a clear subject, facts, next step, button and logo", () => {
    const m = alertEmail(alert, "me@x.com");
    expect(m.subject).toBe("[High] Your bot did not reply to 1 customer message · Demo");
    expect(m.html).toContain("HIGH SEVERITY");
    expect(m.html).toContain("🚨");
    expect(m.html).toContain('/icon.png"');
    expect(m.html).toContain('href="https://proofmyai.com/app/p/3/incidents"');
    expect(m.html).toContain("Check that your bot is online");
    expect(m.html).toContain("/app/p/3/settings#notifications");
    expect(m.html).toContain(">Manage alerts</a>");
    expect(m.text).toContain("View incident: https://proofmyai.com/app/p/3/incidents");
  });

  it("test and resolved alerts are labelled correctly", () => {
    const t = alertEmail({ ...alert, code: "TEST_ALERT", title: "Test alert from ProofMyAI" }, "me@x.com");
    expect(t.subject).toBe("Test alert · Demo");
    expect(t.html).toContain("Your alerts are working");
    expect(t.html).not.toContain("HIGH SEVERITY");
    const r = alertEmail({ ...alert, kind: "resolved" }, "me@x.com");
    expect(r.subject).toMatch(/^Resolved: /);
    expect(r.html).toContain("RESOLVED");
  });

  it("escapes user content", () => {
    const m = ticketReplyEmail("PMA-0001", "<script>x</script>", "A&B", "Try <b>this</b>", false, "https://wa.me/1");
    expect(m.html).not.toContain("<script>x");
    expect(m.html).toContain("&lt;b&gt;this&lt;/b&gt;");
    expect(passwordResetEmail("https://proofmyai.com/reset?token=a&b=1", 30).html).toContain("token=a&amp;b=1");
  });

  it("weekly summary lists module scores", () => {
    const m = digestEmail({ projectId: 3, projectName: "Demo", score: 82, modules: [["💬 Chatbot accuracy", 91, "120 answers"], ["🤖 AI agents", null, ""]], answers: 120, bad: 11, newIncidents: 2, openIncidents: 1, top: ["Bot made up a price"] });
    expect(m.subject).toBe("Weekly AI quality summary · Demo");
    expect(m.html).toContain("AI Health score: 82/100");
    expect(m.html).toContain("91% · 120 answers");
    expect(m.html).toContain("Not set up");
  });
});

describe("founding customers", () => {
  it("claims instantly, blocks double claims, and ends automatically", async () => {
    const now = new Date("2026-10-01T10:00:00Z");
    const r = await claimFoundingSpot(userId, now);
    expect(r.ok).toBe(true);
    expect(billingState(userId).plan.id).toBe("growth");
    expect(foundingStatus(userId)).toMatchObject({ claimed: true, active: true });
    expect(foundingSpotsLeft()).toBe(FOUNDING_OFFER.spots - 1);
    expect(await claimFoundingSpot(userId, now)).toMatchObject({ ok: false, error: expect.stringMatching(/already/) });

    // 7 days before the end: one reminder, plan unchanged
    const remind = new Date(now.getTime() + (FOUNDING_OFFER.days - 5) * 86400000);
    expect(await processFoundingPeriods(remind)).toEqual({ reminded: 1, ended: 0 });
    expect(await processFoundingPeriods(remind)).toEqual({ reminded: 0, ended: 0 });
    // After the end: back to Free
    expect(await processFoundingPeriods(new Date(now.getTime() + (FOUNDING_OFFER.days + 1) * 86400000))).toEqual({ reminded: 0, ended: 1 });
    expect(billingState(userId).plan.id).toBe("free");
    expect(foundingStatus(userId)).toMatchObject({ claimed: true, active: false });
  });

  it("does not end a founding customer who started a paid subscription", async () => {
    const now = new Date("2026-10-01T10:00:00Z");
    await claimFoundingSpot(userId, now);
    run("UPDATE users SET plan_status = 'active', paddle_subscription_id = 'sub_1' WHERE id = ?", userId);
    expect((await processFoundingPeriods(new Date(now.getTime() + 200 * 86400000))).ended).toBe(0);
    expect(get<{ plan: string }>("SELECT plan FROM users WHERE id = ?", userId)?.plan).toBe("growth");
  });

  it("refuses paying customers and stops when spots run out", async () => {
    run("UPDATE users SET plan = 'growth', plan_status = 'active' WHERE id = ?", userId);
    expect((await claimFoundingSpot(userId)).ok).toBe(false);
    for (let i = 0; i < FOUNDING_OFFER.spots; i++) run("INSERT INTO users (email, password_hash, founding_at) VALUES (?, 'x', datetime('now'))", `f${i}@x.com`);
    expect(foundingSpotsLeft()).toBe(0);
    const other = Number(run("INSERT INTO users (email, password_hash) VALUES ('late@x.com', 'x')").lastInsertRowid);
    expect(await claimFoundingSpot(other)).toMatchObject({ ok: false, error: expect.stringMatching(/taken/) });
  });
});
