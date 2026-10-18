import { beforeEach, describe, expect, it } from "vitest";
import { all, get, run } from "@/lib/db";
import { median, periodicWorkflowChecks, recordWorkflowRun, recordWorkflowState, stoppedWorkflowChecks, stuckRunChecks } from "@/lib/workflows/monitor";
import { mapMakeLog, mapN8nExecution, pollSource } from "@/lib/workflows/pollers";
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
    expect(mapN8nExecution({ id: 6, workflowId: 9, status: "running" }, new Map())).toMatchObject({ status: "running", error_message: null });
    expect(mapN8nExecution({ id: 7, workflowId: 9, status: "waiting" }, new Map())).toBeNull();
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

describe("catching every workflow failure", () => {
  const codes = () => all<{ code: string }>("SELECT code FROM incidents WHERE project_id = ? AND resolved = 0 ORDER BY id", projectId).map((r) => r.code);
  const T0 = Date.parse("2026-10-01T00:00:00Z");
  let n = 0;
  const runAt = (ms: number, extra: Partial<Parameters<typeof recordWorkflowRun>[1]> = {}) => recordWorkflowRun(projectId, {
    platform: "n8n", workflow_id: "sync", workflow_name: "Sync", execution_id: `r-${++n}`, status: "success", started_at: new Date(ms).toISOString(), ...extra,
  });
  beforeEach(() => { n = 0; });

  it("learns each workflow's rhythm and alerts when one stops, even if others keep running", async () => {
    for (let i = 0; i < 12; i++) await runAt(T0 + i * 3600000); // hourly
    await recordWorkflowRun(projectId, { platform: "n8n", workflow_id: "other", execution_id: "o-1", status: "success", started_at: new Date(T0 + 30 * 3600000).toISOString() });
    await stoppedWorkflowChecks(projectId, T0 + 12 * 3600000);
    expect(codes()).toEqual([]);
    await stoppedWorkflowChecks(projectId, T0 + 15 * 3600000); // 4h pause vs 1h usual, longest 1h → limit 3h
    expect(codes()).toEqual(["WORKFLOW_STOPPED"]);
    const d = get<{ detail: string }>("SELECT detail FROM incidents WHERE code = 'WORKFLOW_STOPPED'")!.detail;
    expect(d).toContain("normally runs every 60 min");
    run("UPDATE incidents SET resolved = 1 WHERE code = 'WORKFLOW_STOPPED'"); // resolved by hand (workflow retired)
    await stoppedWorkflowChecks(projectId, T0 + 16 * 3600000);
    expect(codes()).toEqual([]); // not raised again for the same pause
    await runAt(T0 + 15.5 * 3600000);
    expect(codes()).toEqual([]);
  });

  it("does not treat a normal overnight pause as stopped", async () => {
    // Every hour 9:00-17:00 for 3 days: 16h overnight gaps are normal.
    for (let d = 0; d < 3; d++) for (let h = 9; h <= 17; h++) await runAt(T0 + d * 86400000 + h * 3600000);
    await stoppedWorkflowChecks(projectId, T0 + 3 * 86400000 + 8 * 3600000); // next morning 08:00 → 15h pause
    expect(codes()).toEqual([]);
  });

  it("updates a run reported as running when it finishes, and flags runs that hang", async () => {
    await runAt(T0, { status: "running", execution_id: "long" });
    await stuckRunChecks(projectId, T0 + 10 * 60000);
    expect(codes()).toEqual([]);
    await stuckRunChecks(projectId, T0 + 45 * 60000);
    expect(codes()).toEqual(["WORKFLOW_STUCK"]);
    expect(await runAt(T0, { status: "error", execution_id: "long", error_message: "Timeout" })).toBe(true);
    expect(get<{ status: string }>("SELECT status FROM workflow_runs WHERE execution_id = 'long'")!.status).toBe("error");
    await stuckRunChecks(projectId, T0 + 50 * 60000);
    expect(codes()).toEqual(["WORKFLOW_FAILED"]);
  });

  it("alerts on warnings (swallowed errors) and clears on the next clean run", async () => {
    await runAt(T0, { status: "warning" });
    expect(codes()).toEqual(["WORKFLOW_WARNING"]);
    await runAt(T0 + 60000, { output_items: 3 });
    expect(codes()).toEqual([]);
  });

  it("catches dropped items, volume drops and spikes", async () => {
    await runAt(T0, { output_items: 4, input_items: 50 });
    expect(codes()).toEqual(["ITEMS_DROPPED"]);
    for (let i = 1; i <= 12; i++) await runAt(T0 + i * 60000, { output_items: 200 });
    expect(codes()).toEqual([]);
    await runAt(T0 + 13 * 60000, { output_items: 12 });
    expect(codes()).toEqual(["VOLUME_DROP"]);
    await runAt(T0 + 14 * 60000, { output_items: 190 });
    await runAt(T0 + 15 * 60000, { output_items: 2400 });
    expect(codes()).toEqual(["VOLUME_SPIKE"]);
  });

  it("alerts when a workflow is switched off, and on new Make incomplete executions", async () => {
    await recordWorkflowState(projectId, "n8n", "w1", "Leads", { active: false }); // never seen on: sub-workflows are inactive
    expect(codes()).toEqual([]);
    await recordWorkflowState(projectId, "n8n", "w1", "Leads", { active: true });
    await recordWorkflowState(projectId, "n8n", "w1", "Leads", { active: false });
    expect(codes()).toEqual(["WORKFLOW_DEACTIVATED"]);
    await recordWorkflowState(projectId, "n8n", "w1", "Leads", { active: true });
    expect(codes()).toEqual([]);
    await recordWorkflowState(projectId, "make", "77", "Orders", { active: true, incomplete: 0 });
    await recordWorkflowState(projectId, "make", "77", "Orders", { active: true, incomplete: 2 });
    expect(codes()).toEqual(["INCOMPLETE_EXECUTIONS"]);
    await recordWorkflowState(projectId, "make", "77", "Orders", { active: true, incomplete: 0 });
    expect(codes()).toEqual([]);
  });

  it("alerts when the n8n/Make connection fails twice, so monitoring never silently stops", async () => {
    const { lastInsertRowid } = run(
      "INSERT INTO workflow_sources (project_id, platform, name, base_url, api_key_enc) VALUES (?, 'n8n', 'My n8n', 'http://127.0.0.1:1', 'bad')", projectId,
    );
    const src = () => get<Parameters<typeof pollSource>[0]>("SELECT * FROM workflow_sources WHERE id = ?", lastInsertRowid)!;
    expect((await pollSource(src())).error).toBeTruthy();
    expect(codes()).toEqual([]);
    await pollSource(src());
    expect(codes()).toEqual(["SOURCE_UNREACHABLE"]);
  });
});
