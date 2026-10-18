import { beforeEach, describe, expect, it } from "vitest";
import { POST as approvalsPost } from "@/app/api/v1/approvals/route";
import { GET as approvalGet } from "@/app/api/v1/approvals/[id]/route";
import { decideApproval, expireApprovals, findCommitments, ruleSuggestions, submitApproval } from "@/lib/approvals";
import { all, run } from "@/lib/db";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => ({ projectId } = freshDb()));
const codes = () => all<{ code: string }>("SELECT code FROM incidents WHERE project_id = ? AND resolved = 0", projectId).map((r) => r.code);
const noFetch = (async () => new Response("ok")) as unknown as typeof fetch;

describe("what needs a person", () => {
  it("approves routine reversible actions and holds the risky ones", async () => {
    expect((await submitApproval(projectId, { action: "tag", summary: "Tag lead as warm" })).status).toBe("approved");
    expect((await submitApproval(projectId, { action: "refund", summary: "Refund #1", reversible: false })).status).toBe("pending");
    expect((await submitApproval(projectId, { action: "email", summary: "Reply to Omar", details: "We'll send a replacement by Friday." })).reason).toContain("a deadline");
    run("UPDATE projects SET approve_over = 50 WHERE id = ?", projectId);
    expect((await submitApproval(projectId, { action: "pay", summary: "Pay invoice 9", amount: 75 })).status).toBe("pending");
    expect((await submitApproval(projectId, { action: "pay", summary: "Pay invoice 10", amount: 20 })).status).toBe("approved");
  });

  it("asks the first time a category appears, then follows the person's rule", async () => {
    const first = await submitApproval(projectId, { action: "pay", summary: "Pay ACME £40", category: "ACME Ltd" });
    expect(first.status).toBe("pending");
    expect(first.reason).toContain("First time");
    await decideApproval(projectId, first.id, "approve", "owner@x.com", null, noFetch);
    expect((await submitApproval(projectId, { action: "pay", summary: "Pay ACME £41", category: "ACME Ltd" })).status).toBe("approved"); // seen and approved before
    const irreversible = await submitApproval(projectId, { action: "pay", summary: "Pay ACME £42", category: "ACME Ltd", reversible: false });
    expect(irreversible.status).toBe("pending");
    await decideApproval(projectId, irreversible.id, "approve_rule", "owner@x.com", "Trusted supplier", noFetch);
    const ruled = await submitApproval(projectId, { action: "pay", summary: "Pay ACME £43", category: "acme ltd", reversible: false });
    expect(ruled.status).toBe("approved");
    expect(ruled.reason).toContain("your rule");
  });

  it("blocks and reports a retry of a rejected action, and logs who decided", async () => {
    const a = await submitApproval(projectId, { action: "email", summary: "Send apology with 50% discount", agent_name: "Support bot", action_id: "e-1" });
    const done = await decideApproval(projectId, a.id, "reject", "owner@x.com", "No discounts this month", noFetch);
    expect(done).toMatchObject({ status: "rejected", decided_by: "owner@x.com", note: "No discounts this month" });
    const retry = await submitApproval(projectId, { action: "email", summary: "Send apology with 50% discount (retry)", agent_name: "Support bot", action_id: "e-1" });
    expect(retry.status).toBe("rejected");
    expect(codes()).toEqual(["REJECTED_ACTION_RETRIED"]);
    expect(await decideApproval(projectId, a.id, "approve", "x", null, noFetch)).toBeNull(); // can't flip a decided request
  });

  it("calls the agent back, expires stale requests and suggests rules", async () => {
    const calls: string[] = [];
    const spy = (async (url: string, init: RequestInit) => { calls.push(`${url} ${init.body}`); return new Response("ok"); }) as unknown as typeof fetch;
    const a = await submitApproval(projectId, { action: "refund", summary: "R", reversible: false, callback_url: "https://hooks.example.com/x" });
    await decideApproval(projectId, a.id, "approve", "owner@x.com", null, spy);
    expect(calls[0]).toContain('"status":"approved"');
    const old = await submitApproval(projectId, { action: "refund", summary: "Old", reversible: false, expires_in_hours: 1 }, new Date(Date.now() - 2 * 3600000));
    expect(expireApprovals()).toBe(1);
    expect(all<{ status: string }>("SELECT status FROM approvals WHERE id = ?", old.id)[0].status).toBe("expired");
    for (let i = 0; i < 10; i++) {
      const x = await submitApproval(projectId, { action: "pay", summary: `Pay courier ${i}`, category: "DHL", reversible: false });
      await decideApproval(projectId, x.id, "approve", "owner@x.com", null, noFetch);
    }
    expect(ruleSuggestions(projectId)).toEqual([{ category: "DHL", action: "pay", approved: 10 }]);
  });

  it("spots promises in drafts", () => {
    expect(findCommitments("I've issued a full refund and you'll get 20% off next time.")).toEqual(["a refund", "a discount"]);
    expect(findCommitments("Thanks for your message, here is the tracking link.")).toEqual([]);
  });
});

describe("approvals API", () => {
  const auth = { authorization: "Bearer ap_live_test" };
  it("submits, then reports the decision", async () => {
    const res = await approvalsPost(new Request("http://x/api/v1/approvals", { method: "POST", headers: auth, body: JSON.stringify({ action: "refund", summary: "Refund #9", reversible: false }) }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ status: "pending", needs_human: true });
    expect(body.poll_url).toMatch(/\/api\/v1\/approvals\/\d+$/);
    await decideApproval(projectId, body.id, "approve", "owner@x.com", "ok", noFetch);
    const got = await (await approvalGet(new Request(`http://x/api/v1/approvals/${body.id}`, { headers: auth }), { params: Promise.resolve({ id: String(body.id) }) })).json();
    expect(got).toMatchObject({ status: "approved", decided_by: "owner@x.com", note: "ok" });
    expect((await approvalsPost(new Request("http://x/api/v1/approvals", { method: "POST", headers: auth, body: JSON.stringify({ summary: "no action" }) }))).status).toBe(400);
  });
});
