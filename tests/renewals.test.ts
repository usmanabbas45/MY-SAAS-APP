import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async (to: string, mail: { subject: string; text: string }) => { sent.push({ to, ...mail }); return true; }),
  fromAddress: () => "ProofMyAI <alerts@proofmyai.com>",
}));

import { run } from "@/lib/db";
import { sendRenewalReminders } from "@/lib/renewals";
import { freshDb } from "./helpers";

let userId: number;
const now = new Date("2026-10-03T12:00:00Z");
const set = (over: Record<string, string | null>) => {
  const cols = Object.keys(over).map((k) => `${k} = ?`).join(", ");
  run(`UPDATE users SET ${cols} WHERE id = ?`, ...Object.values(over), userId);
};
beforeEach(() => {
  ({ userId } = freshDb());
  sent.length = 0;
  process.env.RESEND_API_KEY = "re_test";
  set({ plan: "growth", plan_status: "active", plan_interval: "year", plan_renews_at: "2026-10-25T00:00:00Z" });
});

describe("yearly renewal reminders", () => {
  it("emails once about 30 days before a yearly renewal", async () => {
    expect(await sendRenewalReminders(now)).toBe(1);
    expect(sent[0].to).toBe("t@example.com");
    expect(sent[0].subject).toBe("Your ProofMyAI Growth plan renews on 25 October 2026");
    expect(sent[0].text).toContain("$790");
    expect(await sendRenewalReminders(now)).toBe(0);
    // next year's renewal gets its own reminder
    set({ plan_renews_at: "2026-10-30T00:00:00Z" });
    expect(await sendRenewalReminders(now)).toBe(1);
  });

  it("skips monthly plans, renewals far away, cancelled plans and trials", async () => {
    set({ plan_interval: "month" });
    expect(await sendRenewalReminders(now)).toBe(0);
    set({ plan_interval: "year", plan_renews_at: "2027-01-01T00:00:00Z" });
    expect(await sendRenewalReminders(now)).toBe(0);
    set({ plan_renews_at: "2026-10-25T00:00:00Z", plan_cancel_at: "2026-10-25T00:00:00Z" });
    expect(await sendRenewalReminders(now)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("reminds 3 days before a free trial turns into a charge", async () => {
    set({ plan_cancel_at: null, plan_status: "trialing", trial_ends_at: "2026-10-10T00:00:00Z", plan_renews_at: "2026-10-10T00:00:00Z" });
    expect(await sendRenewalReminders(now)).toBe(0); // 7 days away
    set({ trial_ends_at: "2026-10-05T12:00:00Z", plan_renews_at: "2026-10-05T12:00:00Z" });
    expect(await sendRenewalReminders(now)).toBe(1);
    expect(sent[0].subject).toBe("Your ProofMyAI free trial ends on 5 October 2026");
    expect(sent[0].text).toContain("$790 per year");
    expect(await sendRenewalReminders(now)).toBe(0);
    set({ plan_interval: "month", trial_ends_at: "2026-10-06T00:00:00Z", plan_renews_at: "2026-10-06T00:00:00Z" });
    expect(await sendRenewalReminders(now)).toBe(1);
    expect(sent[1].text).toContain("$79 per month");
  });
});
