import { beforeEach, describe, expect, it } from "vitest";
import { POST as agentPost } from "@/app/api/v1/agent-runs/route";
import { POST as checkPost } from "@/app/api/v1/check/route";
import { POST as workflowPost } from "@/app/api/v1/workflow-runs/route";
import { decideApproval, submitApproval } from "@/lib/approvals";
import { run } from "@/lib/db";
import { recentTraces, traceTimeline } from "@/lib/traces";
import { freshDb } from "./helpers";

let projectId: number;
const auth = { authorization: "Bearer ap_live_test" };
const post = (fn: (r: Request) => Promise<Response>, path: string, body: unknown) => fn(new Request(`http://x/api/v1/${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) }));
const noFetch = (async () => new Response("ok")) as unknown as typeof fetch;

beforeEach(() => {
  ({ projectId } = freshDb());
  run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 'Refunds', 'Refunds take up to 5 business days after we receive the item.')", projectId);
});

describe("end-to-end trace timeline", () => {
  it("puts the chatbot reply, agent run, approval and workflow of one request on one timeline", async () => {
    const T = "order-4471";
    await post(checkPost, "check", { question: "When will my refund arrive?", answer: "Refunds take up to 5 business days after we receive the item.", trace_id: T });
    await post(agentPost, "agent-runs", { run_id: "run-1", agent_name: "Refund agent", status: "success", trace_id: T, goal: "Refund order 4471", final_output: "Refund prepared for approval.",
      steps: [{ type: "tool", name: "lookup_order", duration_ms: 200 }] });
    const a = await submitApproval(projectId, { action: "refund", summary: "Refund order 4471", reversible: false, trace_id: T });
    await decideApproval(projectId, a.id, "approve", "owner@x.com", null, noFetch);
    await post(workflowPost, "workflow-runs", { platform: "n8n", workflow_id: "wf-1", workflow_name: "Refund sync", execution_id: "e-1", status: "success", output_items: 0, input_items: 1, trace_id: T });

    const steps = traceTimeline(projectId, T);
    expect(steps.map((s) => s.source)).toEqual(["chatbot", "agents", "approvals", "approvals", "workflows"]);
    expect(steps.map((s) => s.ok)).toEqual([true, true, true, true, false]);
    expect(steps[4].title).toContain("success with 0 items");
    expect(recentTraces(projectId)).toEqual([expect.objectContaining({ traceId: T, steps: 5, failed: 1 })]);
  });

  it("records a re-reported workflow run once, and ignores calls without a trace id", async () => {
    const run1 = { platform: "n8n", workflow_id: "wf-1", execution_id: "e-9", status: "success", output_items: 3, trace_id: "t-9" };
    await post(workflowPost, "workflow-runs", run1);
    await post(workflowPost, "workflow-runs", run1);
    await post(workflowPost, "workflow-runs", { ...run1, execution_id: "e-10", trace_id: undefined });
    expect(traceTimeline(projectId, "t-9")).toHaveLength(1);
    expect(recentTraces(projectId)).toHaveLength(1);
  });
});
