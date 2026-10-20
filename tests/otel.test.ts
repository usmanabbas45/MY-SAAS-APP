import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/otel/v1/traces/route";
import { collectRuns, runFromTrace, flattenSpans } from "@/lib/agents/otel";
import { all, get } from "@/lib/db";
import { freshDb } from "./helpers";

const s = (v: string) => ({ stringValue: v });
const ms = (n: number) => String(BigInt(n) * 1000000n);

/** A small agent trace in OTLP JSON: root agent span, one LLM call, one tool call (optionally failing). */
function trace(traceId: string, { toolFails = false, includeRoot = true } = {}) {
  const spans = [
    { traceId, spanId: "b1", parentSpanId: "a1", name: "chat gpt-4o", startTimeUnixNano: ms(1000), endTimeUnixNano: ms(1800),
      attributes: [{ key: "gen_ai.operation.name", value: s("chat") }, { key: "gen_ai.request.model", value: s("gpt-4o") },
        { key: "gen_ai.usage.input_tokens", value: { intValue: "120" } }, { key: "gen_ai.usage.output_tokens", value: { intValue: "30" } },
        { key: "output.value", value: s("Calling get_order") }] },
    { traceId, spanId: "c1", parentSpanId: "a1", name: "execute_tool get_order", startTimeUnixNano: ms(1900), endTimeUnixNano: ms(2300),
      attributes: [{ key: "gen_ai.operation.name", value: s("execute_tool") }, { key: "gen_ai.tool.name", value: s("get_order") },
        { key: "gen_ai.tool.call.arguments", value: s('{"id":"A-1"}') }],
      status: toolFails ? { code: 2, message: "Order API returned 500" } : { code: 1 } },
    { traceId, spanId: "d1", parentSpanId: "a1", name: "RunnableSequence", startTimeUnixNano: ms(1000), endTimeUnixNano: ms(1100), attributes: [] },
  ];
  if (includeRoot) {
    spans.push({ traceId, spanId: "a1", parentSpanId: "", name: "invoke_agent", startTimeUnixNano: ms(900), endTimeUnixNano: ms(2500),
      attributes: [{ key: "gen_ai.agent.name", value: s("Order helper") }, { key: "input.value", value: s("Where is order A-1?") },
        { key: "output.value", value: s("Your order ships tomorrow.") }],
      status: toolFails ? { code: 2, message: "Tool failed" } : { code: 1 } } as never);
  }
  return { resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: s("support-agent") }] }, scopeSpans: [{ spans }] }] };
}

describe("OTLP trace → agent run", () => {
  it("maps GenAI spans to steps and skips framework plumbing spans", () => {
    const r = runFromTrace(flattenSpans(trace("t1")))!;
    expect(r).toMatchObject({ run_id: "t1", agent_name: "Order helper", goal: "Where is order A-1?", status: "success", final_output: "Your order ships tomorrow." });
    expect(r.steps.map((x) => [x.type, x.name, x.duration_ms, x.tokens])).toEqual([["llm", "gpt-4o", 800, 150], ["tool", "get_order", 400, 0]]);
    expect(r.steps[1].input).toBe('{"id":"A-1"}');
  });

  it("records failed spans as errors", () => {
    const r = runFromTrace(flattenSpans(trace("t2", { toolFails: true })))!;
    expect(r.status).toBe("error");
    expect(r.steps[1].error).toBe("Order API returned 500");
  });

  it("waits for the root span when children are exported first", () => {
    expect(collectRuns(99, trace("t3", { includeRoot: false }))).toEqual([]);
    const root = trace("t3");
    root.resourceSpans[0].scopeSpans[0].spans = root.resourceSpans[0].scopeSpans[0].spans.filter((x) => x.spanId === "a1");
    const runs = collectRuns(99, root);
    expect(runs).toHaveLength(1);
    expect(runs[0].steps).toHaveLength(2);
  });
});

describe("POST /api/v1/otel/v1/traces", () => {
  let projectId: number;
  beforeEach(() => ({ projectId } = freshDb()));
  const req = (body: unknown, type = "application/json") =>
    new Request("http://x/api/v1/otel/v1/traces", { method: "POST", headers: { authorization: "Bearer ap_live_test", "content-type": type }, body: JSON.stringify(body) });

  it("stores each finished trace as an agent run with the usual checks", async () => {
    const res = await POST(req(trace("t4", { toolFails: true })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ partialSuccess: {} });
    const run = get<{ agent_name: string; status: string; issues_json: string }>("SELECT agent_name, status, issues_json FROM agent_runs WHERE project_id = ?", projectId)!;
    expect(run).toMatchObject({ agent_name: "Order helper", status: "error" });
    expect(run.issues_json).toMatch(/Order API returned 500|TOOL|ERROR/i);
    // An exporter retry of the same trace is accepted without a duplicate.
    expect((await POST(req(trace("t4", { toolFails: true })))).status).toBe(200);
    expect(all("SELECT id FROM agent_runs WHERE project_id = ?", projectId)).toHaveLength(1);
  });

  it("explains how to switch protobuf exporters to JSON", async () => {
    const res = await POST(new Request("http://x/api/v1/otel/v1/traces", { method: "POST", headers: { authorization: "Bearer ap_live_test", "content-type": "application/x-protobuf" }, body: "x" }));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/http\/json/);
  });
});
