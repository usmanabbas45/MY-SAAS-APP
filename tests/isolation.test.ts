import { beforeEach, describe, expect, it } from "vitest";
import { GET as approvalGet } from "@/app/api/v1/approvals/[id]/route";
import { POST as checkPost } from "@/app/api/v1/check/route";
import { submitApproval } from "@/lib/approvals";
import { get, run } from "@/lib/db";
import { projectAccess } from "@/lib/projects";
import { traceTimeline, recordTrace } from "@/lib/traces";
import { freshDb } from "./helpers";

/** Tenant isolation: one customer's key or login never reaches another customer's data. */
let userA: number, projectA: number, userB: number, projectB: number;
beforeEach(() => {
  ({ userId: userA, projectId: projectA } = freshDb());
  userB = run("INSERT INTO users (email, password_hash) VALUES ('b@example.com', 'x')").lastInsertRowid;
  projectB = run("INSERT INTO projects (user_id, name, api_key) VALUES (?, 'B', 'ap_live_other')", userB).lastInsertRowid;
});

describe("tenant isolation", () => {
  it("a user can't open another customer's project", () => {
    expect(projectAccess(userA, projectA).project.id).toBe(projectA);
    expect(() => projectAccess(userA, projectB)).toThrow();
    expect(() => projectAccess(userB, projectA)).toThrow();
  });

  it("an API key can't read another project's approval", async () => {
    const a = await submitApproval(projectB, { action: "refund", summary: "B's refund", reversible: false });
    const as = (key: string) => approvalGet(new Request(`http://x/api/v1/approvals/${a.id}`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ id: String(a.id) }) });
    expect((await as("ap_live_test")).status).toBe(404);
    expect((await as("ap_live_other")).status).toBe(200);
    expect((await as("ap_live_wrong")).status).toBe(401);
  });

  it("data sent with one key is stored only in that key's project, and traces stay separate", async () => {
    await checkPost(new Request("http://x/api/v1/check", { method: "POST", headers: { authorization: "Bearer ap_live_other" }, body: JSON.stringify({ question: "Hi?", answer: "Hello!", trace_id: "shared-id" }) }));
    const owner = get<{ p: number }>("SELECT a.project_id AS p FROM audit_items i JOIN audits a ON a.id = i.audit_id ORDER BY i.id DESC LIMIT 1")?.p;
    expect(owner).toBe(projectB);
    recordTrace(projectA, "shared-id", "workflows", true, "A's step");
    expect(traceTimeline(projectA, "shared-id").map((e) => e.title)).toEqual(["A's step"]);
    expect(traceTimeline(projectB, "shared-id")).toHaveLength(1);
    expect(traceTimeline(projectB, "shared-id")[0].title).not.toBe("A's step");
  });
});
