import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string; headers?: Record<string, string> }[] = [];
vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async (to: string, mail: { subject: string; text: string; headers?: Record<string, string> }) => {
    sent.push({ to, subject: mail.subject, text: mail.text, headers: mail.headers });
    return true;
  }),
  fromAddress: () => "ProofMyAI <alerts@proofmyai.com>",
}));

import { billingState, usage } from "@/lib/billing";
import { all, get, run } from "@/lib/db";
import { createDemoProject, deleteDemoProject, demoProjectOf } from "@/lib/demo";
import { fixList } from "@/lib/audit/run";
import { projectHealth } from "@/lib/health";
import { DONE, isActivated, sendDueOnboarding } from "@/lib/onboarding";
import { runDueMonitors } from "@/lib/uptime";
import { unsubscribeWelcome, welcomeToken } from "@/lib/unsubscribe";
import { freshDb } from "./helpers";

let userId: number, projectId: number;
beforeEach(() => {
  ({ userId, projectId } = freshDb());
  sent.length = 0;
  process.env.RESEND_API_KEY = "re_test";
});

describe("demo data", () => {
  it("creates one filled demo project that doesn't count towards the plan", async () => {
    const before = usage(userId, billingState(userId).plan);
    const id = await createDemoProject(userId);
    expect(await createDemoProject(userId)).toBe(id); // only one
    expect(demoProjectOf(userId)).toBe(id);
    expect(usage(userId, billingState(userId).plan)).toEqual(before);

    const audits = all<{ id: number; score: number }>("SELECT id, score FROM audits WHERE project_id = ? ORDER BY id", id);
    expect(audits).toHaveLength(3); // last week, this week, and two weeks of live tracking
    const groups = fixList(audits[1].id).map((g) => g.doc);
    expect(groups).toEqual(expect.arrayContaining(["Returns & refunds", "Warranty", "Bot prompt/logic: rule \"price match\" broken"]));
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_fixes WHERE project_id = ?", id)?.n).toBe(1);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM agent_runs WHERE project_id = ?", id)?.n).toBe(5);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM workflow_runs WHERE project_id = ? AND status = 'error'", id)?.n).toBe(3);
    const h = projectHealth(id);
    expect(h.overall).not.toBeNull();
    expect(Object.values(h.modules).filter((m) => m.score != null).length).toBeGreaterThanOrEqual(3);

    // the made-up URL is never probed
    const fetcher = vi.fn();
    await runDueMonitors(new Date(Date.now() + 7200000), fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    // and demo data never sends email
    expect(sent).toHaveLength(0);

    expect(deleteDemoProject(userId)).toBe(true);
    expect(demoProjectOf(userId)).toBeNull();
    expect(get("SELECT id FROM projects WHERE id = ?", projectId)).toBeTruthy(); // the real project stays
  });

  it("the demo doesn't count as connecting a real bot", async () => {
    await createDemoProject(userId);
    expect(isActivated(userId)).toBe(false);
    run("INSERT INTO audits (project_id, name, mode, status) VALUES (?, 'x', 'basic', 'done')", projectId);
    expect(isActivated(userId)).toBe(true);
  });
});

describe("welcome emails", () => {
  const signup = (daysAgo: number) => run("UPDATE users SET created_at = ?, email_verified_at = '2026-01-01' WHERE id = ?",
    new Date(Date.now() - daysAgo * 86400000).toISOString().replace("T", " ").slice(0, 19), userId);
  const step = () => get<{ s: number }>("SELECT onboard_step AS s FROM users WHERE id = ?", userId)!.s;

  it("sends day 1, 3 and 7 emails once each, then stops", async () => {
    signup(0.5);
    expect(await sendDueOnboarding()).toBe(0);
    signup(1.1);
    expect(await sendDueOnboarding()).toBe(1);
    expect(await sendDueOnboarding()).toBe(0);
    expect(sent[0].subject).toMatch(/Connect your chatbot/);
    expect(sent[0].text).toContain(`/app/p/${projectId}/connect`);
    expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    signup(3.2);
    expect(await sendDueOnboarding()).toBe(1);
    signup(7.5);
    expect(await sendDueOnboarding()).toBe(1);
    expect(sent.map((m) => m.subject)).toEqual([expect.stringMatching(/Connect/), expect.stringMatching(/mistakes/), expect.stringMatching(/set it up/)]);
    expect(step()).toBe(DONE);
    signup(30);
    expect(await sendDueOnboarding()).toBe(0);
  });

  it("stops when the user connects something, skips unconfirmed emails, and honours unsubscribe", async () => {
    run("UPDATE users SET created_at = ? WHERE id = ?", new Date(Date.now() - 2 * 86400000).toISOString().replace("T", " ").slice(0, 19), userId);
    expect(await sendDueOnboarding()).toBe(0); // email not confirmed

    signup(2);
    run("INSERT INTO workflow_sources (project_id, platform, name, base_url, api_key_enc) VALUES (?, 'n8n', 'n8n', 'https://n8n.example', 'x')", projectId);
    expect(await sendDueOnboarding()).toBe(0);
    expect(step()).toBe(DONE);

    run("DELETE FROM workflow_sources");
    run("UPDATE users SET onboard_step = 0");
    expect(unsubscribeWelcome(userId, "bad")).toBe(false);
    expect(unsubscribeWelcome(userId, welcomeToken(userId))).toBe(true);
    expect(await sendDueOnboarding()).toBe(0);
  });

  it("a late-confirmed account gets the right email, not all three at once", async () => {
    signup(5);
    expect(await sendDueOnboarding()).toBe(1);
    expect(sent[0].subject).toMatch(/mistakes/);
    expect(await sendDueOnboarding()).toBe(0);
  });
});
