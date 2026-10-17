import { beforeEach, describe, expect, it } from "vitest";
import { all, get, run } from "@/lib/db";
import { median, periodicWorkflowChecks, recordWorkflowRun } from "@/lib/workflows/monitor";
import { mapMakeLog, mapN8nExecution } from "@/lib/workflows/pollers";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => ({ projectId } = freshDb()));

const openIncidents = () => all<{ code: string }>("SELECT code FROM incidents WHERE project_id = ? AND resolved = 0", projectId).map((r) => r.code);

describe("workflow monitoring", () => {
  it("opens an incident on failure and resolves it on the next success", async () => {
    await recordWorkflowRun(projectId, { platform: "n8n", workflow_id: "7", workflow_name: "Leads", execution_id: "1", status: "error", error_message: "401 from HubSpot" });
    expect(openIncidents()).toEqual(["WORKFLOW_FAILED"]);
    await recordWorkflowRun(projectId, { platform: "n8n", workflow_id: "7", execution_id: "2", status: "success", output_items: 3 });
    expect(openIncidents()).toEqual([]);
  });

  it("ignores duplicate executions", async () => {
    const r = { platform: "make" as const, workflow_id: "s1", execution_id: "e1", status: "success" as const };
    expect(await recordWorkflowRun(projectId, r)).toBe(true);
    expect(await recordWorkflowRun(projectId, r)).toBe(false);
  });

  it("detects silent failures (success with zero output)", async () => {
    await recordWorkflowRun(projectId, { platform: "other", workflow_id: "w", execution_id: "1", status: "success", output_items: 0 });
    expect(openIncidents()).toEqual(["SILENT_FAILURE"]);
  });

  it("detects slow executions against the median", async () => {
    for (let i = 0; i < 6; i++) {
      await recordWorkflowRun(projectId, { platform: "n8n", workflow_id: "w", execution_id: `ok${i}`, status: "success", duration_ms: 2000, started_at: new Date(Date.now() - (10 - i) * 60000).toISOString() });
    }
    await recordWorkflowRun(projectId, { platform: "n8n", workflow_id: "w", execution_id: "slow", status: "success", duration_ms: 30000 });
    expect(openIncidents()).toContain("SLOW_EXECUTION");
  });

  it("detects high error rates and stale sources", async () => {
    for (let i = 0; i < 6; i++) {
      await recordWorkflowRun(projectId, { platform: "n8n", workflow_id: "w", execution_id: `x${i}`, status: i < 3 ? "error" : "success", output_items: 1 });
    }
    run("INSERT INTO workflow_sources (project_id, platform, name, base_url, api_key_enc, expected_interval_min) VALUES (?, 'make', 'Make', 'https://eu1.make.com', 'x', 60)", projectId);
    await periodicWorkflowChecks(projectId);
    expect(openIncidents()).toEqual(expect.arrayContaining(["HIGH_ERROR_RATE", "STALE"]));
  });

  it("computes medians", () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("platform mappers", () => {
  it("maps n8n executions", () => {
    const m = mapN8nExecution({ id: 5, workflowId: 9, status: "error", startedAt: "2026-01-01T00:00:00Z", stoppedAt: "2026-01-01T00:00:02Z" }, new Map([["9", "CRM sync"]]));
    expect(m).toMatchObject({ execution_id: "5", workflow_name: "CRM sync", status: "error", duration_ms: 2000 });
    expect(mapN8nExecution({ id: 6, workflowId: 9, status: "running" }, new Map())).toBeNull();
  });

  it("maps Make scenario logs", () => {
    expect(mapMakeLog("11", { imtId: "abc", status: 3, duration: 1200 })).toMatchObject({ status: "error", execution_id: "abc" });
    expect(mapMakeLog("11", { imtId: "abd", status: 1 })).toMatchObject({ status: "success" });
    expect(mapMakeLog("11", { status: 1 })).toBeNull();
  });
});

describe("database constraints", () => {
  it("keeps one row per execution", async () => {
    await recordWorkflowRun(projectId, { platform: "n8n", workflow_id: "w", execution_id: "1", status: "success" });
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM workflow_runs")?.n).toBe(1);
  });
});

describe("empty runs: quiet spell or broken?", () => {
  const openSilent = () => all<{ severity: string; title: string; detail: string }>("SELECT severity, title, detail FROM incidents WHERE project_id = ? AND code = 'SILENT_FAILURE' AND resolved = 0", projectId);
  let n = 0;
  const send = (output: number, input?: number) => recordWorkflowRun(projectId, {
    platform: "n8n", workflow_id: "orders", workflow_name: "Orders", execution_id: `ex-${++n}`, status: "success",
    started_at: new Date(Date.parse("2026-10-17T00:00:00Z") + n * 3600000).toISOString(), output_items: output, input_items: input,
  });
  beforeEach(() => { n = 0; });

  it("0 in and 0 out is a quiet run; items in but 0 out is a high alert", async () => {
    await send(0, 0);
    expect(openSilent()).toEqual([]);
    expect(get<{ quiet: number }>("SELECT quiet FROM workflow_runs WHERE execution_id = 'ex-1'")!.quiet).toBe(1);
    await send(0, 12);
    expect(openSilent()).toMatchObject([{ severity: "high", title: 'n8n "Orders" received 12 items but produced nothing' }]);
    await send(5, 5);
    expect(openSilent()).toEqual([]);
  });

  it("alerts on the first empty run of a workflow that is almost never empty", async () => {
    for (let i = 0; i < 20; i++) await send(40);
    await send(0);
    const [inc] = openSilent();
    expect(inc.detail).toContain("almost never empty");
    expect(inc.detail).toContain("usually produces about 40 items");
    expect(inc.detail).toContain("Last run with output: 60 min earlier (40 items)");
  });

  it("learns normal quiet spells and only alerts when the current one is longer", async () => {
    // Busy by day, two empty runs overnight, repeated.
    for (let d = 0; d < 4; d++) { for (let i = 0; i < 6; i++) await send(10); await send(0); await send(0); }
    expect(openSilent()).toEqual([]);
    await send(10);
    await send(0); await send(0); await send(0);
    expect(openSilent()).toEqual([]); // 3 in a row: within max(3, 2)
    await send(0);
    expect(openSilent()[0].detail).toContain("4 empty runs in a row");
    expect(openSilent()[0].detail).toContain("longest one before was 2 runs");
    await send(10);
    expect(openSilent()).toEqual([]);
  });

  it("still alerts while it has too little history to judge, with a hint", async () => {
    await send(0);
    expect(openSilent()[0].detail).toContain("send input_items: 0");
  });
});
