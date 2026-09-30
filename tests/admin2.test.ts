import { beforeEach, describe, expect, it } from "vitest";
import { adoption, funnel, recordDailyMetrics, metricsHistory, retention, revenue, atRiskCustomers } from "@/lib/analytics";
import { createUser } from "@/lib/auth";
import { addBlock, isBlocked, listBlocks, normalisePattern, removeBlock } from "@/lib/blocklist";
import { kbDocs, RULES_DOC_TITLE } from "@/lib/audit/run";
import { get, run } from "@/lib/db";
import { freshDb } from "./helpers";

let userId: number;
let projectId: number;
beforeEach(() => ({ userId, projectId } = freshDb()));
const notAdmin = () => false;

describe("blocklist", () => {
  it("normalises emails and domains", () => {
    expect(normalisePattern(" Bad@Spam.com ")).toBe("bad@spam.com");
    expect(normalisePattern("spam.com")).toBe("@spam.com");
    expect(normalisePattern("*@spam.com")).toBe("@spam.com");
    expect(normalisePattern("not valid")).toBeNull();
  });

  it("blocks sign-ups by email and by domain (including subdomains) and suspends existing accounts", () => {
    const u = createUser("abuser@spam.com", "password123").user!;
    run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('t', ?, '2999-01-01')", u.id);
    const r = addBlock("@spam.com", "fake sign-ups", "boss@x.com", notAdmin);
    expect(r).toMatchObject({ pattern: "@spam.com", suspended: ["abuser@spam.com"] });
    expect(get<{ s: string | null }>("SELECT suspended_at AS s FROM users WHERE id = ?", u.id)?.s).not.toBeNull();
    expect(get("SELECT 1 FROM sessions WHERE user_id = ?", u.id)).toBeUndefined();
    expect(isBlocked("new@mail.spam.com")).toBe(true);
    expect(isBlocked("fine@nospam.com")).toBe(false);
    expect(createUser("another@spam.com", "password123").error).toMatch(/can't be used/);
    expect(addBlock("@spam.com", "", "boss@x.com", notAdmin).error).toMatch(/already/);
    removeBlock(listBlocks()[0].id);
    expect(createUser("another@spam.com", "password123").user).toBeTruthy();
  });

  it("never blocks an admin", () => {
    createUser("boss@company.com", "password123");
    expect(addBlock("@company.com", "", "boss@company.com", (e) => e === "boss@company.com").error).toMatch(/admin/);
  });
});

describe("analytics", () => {
  it("builds the funnel from real usage", () => {
    const u2 = createUser("trial@x.com", "password123").user!;
    run("UPDATE users SET plan = 'growth', plan_status = 'active', trial_ends_at = '2020-01-01T00:00:00Z' WHERE id = ?", u2.id);
    run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 'A', 'b')", projectId);
    const steps = funnel(null);
    expect(steps.map((s) => s.count)).toEqual([2, 1, 0, 1, 1]);
    const rev = revenue();
    expect(rev).toMatchObject({ mrr: 79, paying: 1, trialsEnded: 1, trialConverted: 1, trialConversion: 1 });
    recordDailyMetrics();
    expect(metricsHistory().at(-1)).toMatchObject({ users: 2, paying: 1, mrr: 79 });
    expect(adoption().find((f) => f.feature.includes("Knowledge base"))?.users).toBe(1);
  });

  it("computes weekly retention cohorts from activity days", () => {
    const now = new Date("2026-09-30T12:00:00Z"); // a Wednesday
    run("UPDATE users SET created_at = '2026-09-21 10:00:00' WHERE id = ?", userId); // Monday of last week
    run("DELETE FROM user_activity");
    run("INSERT INTO user_activity (user_id, day) VALUES (?, '2026-09-21'), (?, '2026-09-29')", userId, userId);
    const c = retention(2, now);
    expect(c[0]).toMatchObject({ week: "2026-09-21", size: 1, weeks: [1, 1] });
    expect(c[1].weeks).toEqual([null, null]);
  });

  it("lists paying customers at risk", () => {
    run("UPDATE users SET plan = 'starter', plan_status = 'past_due', last_seen_at = ? WHERE id = ?", new Date().toISOString(), userId);
    expect(atRiskCustomers()[0]).toMatchObject({ id: userId, reason: "Payment failed" });
  });
});

describe("must-say statements in the knowledge base", () => {
  it("adds required statements as an approved article only when rules exist", () => {
    expect(kbDocs(projectId).some((d) => d.title === RULES_DOC_TITLE)).toBe(false);
    run("INSERT INTO rules (project_id, kind, pattern) VALUES (?, 'must_include', 'pricing or plans => Prices include VAT')", projectId);
    const doc = kbDocs(projectId).find((d) => d.title === RULES_DOC_TITLE)!;
    expect(doc.content).toContain('When pricing or plans comes up: "Prices include VAT"');
  });
});
