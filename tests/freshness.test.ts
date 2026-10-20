import { beforeEach, describe, expect, it } from "vitest";
import { run } from "@/lib/db";
import { connectionFreshness } from "@/lib/freshness";
import { freshDb } from "./helpers";

let projectId: number;
const now = Date.parse("2026-10-20T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60000).toISOString();

beforeEach(() => ({ projectId } = freshDb()));

describe("connection freshness", () => {
  it("is empty when nothing is connected", () => {
    expect(connectionFreshness(projectId, now)).toEqual([]);
  });

  it("labels scheduled connections and flags an overdue check", () => {
    run("INSERT INTO workflow_sources (project_id, platform, name, base_url, api_key_enc, last_polled_at) VALUES (?, 'n8n', 'Main n8n', 'https://n8n.example', 'x', ?)", projectId, ago(10));
    run("INSERT INTO crm_sources (project_id, provider, name, required_fields, followup_hours, last_polled_at, created_at) VALUES (?, 'hubspot', 'HubSpot', '', 0, ?, ?)", projectId, ago(240), ago(5000));
    const rows = connectionFreshness(projectId, now);
    expect(rows.find((r) => r.name === "Main n8n")).toMatchObject({ delivery: "scheduled", every: "every 15 min", state: "fresh", nextCheck: now - 10 * 60000 + 15 * 60000 });
    expect(rows.find((r) => r.name === "HubSpot")).toMatchObject({ state: "delayed" });
  });

  it("shows a connection error and a first check that hasn't happened yet", () => {
    run("INSERT INTO workflow_sources (project_id, platform, name, base_url, api_key_enc, last_polled_at, last_error) VALUES (?, 'make', 'Make', 'https://eu1.make.com', 'x', ?, 'HTTP 401: invalid token')", projectId, ago(5));
    run("INSERT INTO sheet_watches (project_id, name, url, csv_url, stale_hours) VALUES (?, 'Leads', 'https://docs.google.com/x', 'https://docs.google.com/x/export', 12)", projectId);
    const rows = connectionFreshness(projectId, now);
    expect(rows.find((r) => r.name === "Make")).toMatchObject({ state: "error", note: "HTTP 401: invalid token" });
    expect(rows.find((r) => r.name === "Leads")).toMatchObject({ state: "waiting" });
  });

  it("treats pushed data and heartbeats as live", () => {
    run("INSERT INTO agent_runs (project_id, external_id, agent_name, goal, status, final_output, steps_json, total_cost_usd, total_ms, issues_json, score, created_at) VALUES (?, 'r1', 'Bot', '', 'success', '', '[]', 0, 0, '[]', 100, ?)", projectId, ago(3));
    run("INSERT INTO job_heartbeats (project_id, name, token, every_min, grace_min, status, last_ping_at, created_at) VALUES (?, 'Nightly sync', 'tok', 60, 10, 'up', ?, ?)", projectId, ago(120), ago(5000));
    const rows = connectionFreshness(projectId, now);
    expect(rows.find((r) => r.name === "AI agent runs")).toMatchObject({ delivery: "live", state: "fresh" });
    expect(rows.find((r) => r.name === "Nightly sync")).toMatchObject({ delivery: "live", state: "delayed" });
  });
});
