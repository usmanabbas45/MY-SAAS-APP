import { z } from "zod";
import { all, get, run } from "../db";
import { raiseIncident, resolveIncidents } from "../incidents";
import { truncate } from "../text";

export const PLATFORMS = ["n8n", "make", "zapier", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const WorkflowRunSchema = z.object({
  platform: z.enum(PLATFORMS).default("other"),
  workflow_id: z.string().min(1).max(200),
  workflow_name: z.string().max(300).optional(),
  execution_id: z.string().min(1).max(200),
  status: z.enum(["success", "error", "warning", "running", "waiting", "cancelled", "crashed"]),
  started_at: z.string().datetime({ offset: true }).optional(),
  duration_ms: z.number().nonnegative().nullish(),
  output_items: z.number().int().nonnegative().nullish(),
  /** Items the run received (e.g. new rows or orders fetched). Tells "nothing to process" apart from "broken". */
  input_items: z.number().int().nonnegative().nullish(),
  error_message: z.string().max(5000).nullish(),
});
export type WorkflowRunInput = z.infer<typeof WorkflowRunSchema>;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Returns true if the execution was new (not previously recorded). */
export async function recordWorkflowRun(projectId: number, input: WorkflowRunInput): Promise<boolean> {
  const name = input.workflow_name || input.workflow_id;
  const startedAt = input.started_at ? new Date(input.started_at).toISOString() : new Date().toISOString();
  const status = input.status === "crashed" ? "error" : input.status;
  const res = run(
    `INSERT OR IGNORE INTO workflow_runs (project_id, platform, workflow_id, workflow_name, execution_id, status, started_at, duration_ms, output_items, input_items, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    projectId, input.platform, input.workflow_id, name, input.execution_id, status, startedAt,
    input.duration_ms ?? null, input.output_items ?? null, input.input_items ?? null, input.error_message ?? null,
  );
  if (res.changes === 0) return false;
  await evaluateRun(projectId, { ...input, status, workflow_name: name, started_at: startedAt });
  return true;
}

const ago = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 120 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`;
};

/**
 * Is an empty "success" a broken workflow or just a quiet spell? Without input counts we learn the workflow's own
 * pattern from its last 50 runs: one that is rarely empty alerts on the first empty run; one that often has
 * nothing to do alerts only when the current run of empties is longer than any quiet spell it had before.
 */
export function judgeEmptyRun(projectId: number, r: { platform: string; workflow_id: string; execution_id: string; started_at: string }):
  { alert: boolean; reason: string } {
  const history = all<{ output_items: number; started_at: string }>(
    `SELECT output_items, started_at FROM workflow_runs WHERE project_id = ? AND platform = ? AND workflow_id = ? AND status = 'success'
       AND output_items IS NOT NULL AND execution_id <> ? AND started_at <= ? ORDER BY started_at DESC LIMIT 50`,
    projectId, r.platform, r.workflow_id, r.execution_id, r.started_at,
  );
  const lastGood = history.find((h) => h.output_items > 0);
  const lastGoodText = lastGood ? ` Last run with output: ${ago(Date.parse(r.started_at) - Date.parse(lastGood.started_at))} earlier (${lastGood.output_items} items).` : "";
  const hint = " If there was simply nothing to process, send input_items: 0 with the run and ProofMyAI will treat it as a quiet run.";
  if (history.length < 5) return { alert: true, reason: `Reported success with 0 output items.${lastGoodText}${hint}` };

  let streak = 1;
  while (streak - 1 < history.length && history[streak - 1].output_items === 0) streak++;
  let longest = 0;
  for (let i = streak - 1, cur = 0; i < history.length; i++) {
    cur = history[i].output_items === 0 ? cur + 1 : 0;
    longest = Math.max(longest, cur);
  }
  const zeros = history.filter((h) => h.output_items === 0).length;
  const typical = median(history.filter((h) => h.output_items > 0).map((h) => h.output_items));
  if (zeros / history.length < 0.1) {
    return { alert: true, reason: `This workflow is almost never empty (${zeros} of its last ${history.length} runs) and usually produces about ${typical} items.${lastGoodText}` };
  }
  if (streak > Math.max(3, longest)) {
    return { alert: true, reason: `${streak} empty runs in a row. Quiet spells are normal for this workflow, but the longest one before was ${longest} run${longest === 1 ? "" : "s"}.${lastGoodText}` };
  }
  return { alert: false, reason: "" };
}

async function evaluateRun(projectId: number, r: WorkflowRunInput & { workflow_name: string }) {
  const key = (code: string) => `wf:${r.platform}:${r.workflow_id}:${code}`;
  const label = `${r.platform === "other" ? "Workflow" : r.platform} "${r.workflow_name}"`;

  if (r.status === "error") {
    await raiseIncident(projectId, {
      module: "workflows", code: "WORKFLOW_FAILED", severity: "high",
      title: `${label} failed`,
      detail: r.error_message ? truncate(r.error_message, 500) : `Execution ${r.execution_id} ended in an error.`,
      dedupeKey: key("failed"),
    });
    return;
  }
  if (r.status === "success") {
    resolveIncidents(projectId, key("failed"));
    resolveIncidents(projectId, key("stale"));
    if (r.output_items === 0 && r.input_items != null && r.input_items > 0) {
      // It received work and produced nothing: broken, whatever the history says.
      await raiseIncident(projectId, {
        module: "workflows", code: "SILENT_FAILURE", severity: "high",
        title: `${label} received ${r.input_items} items but produced nothing`,
        detail: `Execution ${r.execution_id} reported success, but none of the ${r.input_items} input items made it to the output. A step is filtering or dropping everything.`,
        dedupeKey: key("silent"),
      });
    } else if (r.output_items === 0) {
      const verdict = r.input_items === 0 ? { alert: false, reason: "" } : judgeEmptyRun(projectId, { ...r, started_at: r.started_at! });
      if (verdict.alert) {
        await raiseIncident(projectId, {
          module: "workflows", code: "SILENT_FAILURE", severity: "medium",
          title: `${label} succeeded but produced nothing`,
          detail: `Execution ${r.execution_id}: ${verdict.reason}`,
          dedupeKey: key("silent"),
        });
      } else {
        run("UPDATE workflow_runs SET quiet = 1 WHERE project_id = ? AND platform = ? AND execution_id = ?", projectId, r.platform, r.execution_id);
      }
    } else if (r.output_items && r.output_items > 0) {
      resolveIncidents(projectId, key("silent"));
    }
    if (r.duration_ms != null) {
      const history = all<{ duration_ms: number }>(
        `SELECT duration_ms FROM workflow_runs WHERE project_id = ? AND platform = ? AND workflow_id = ? AND status = 'success'
           AND duration_ms IS NOT NULL AND execution_id <> ? ORDER BY started_at DESC LIMIT 20`,
        projectId, r.platform, r.workflow_id, r.execution_id,
      ).map((x) => x.duration_ms);
      const typical = median(history);
      if (history.length >= 5 && typical > 0 && r.duration_ms > typical * 3 && r.duration_ms - typical > 5000) {
        await raiseIncident(projectId, {
          module: "workflows", code: "SLOW_EXECUTION", severity: "low",
          title: `${label} is running slowly`,
          detail: `Took ${(r.duration_ms / 1000).toFixed(1)}s vs a typical ${(typical / 1000).toFixed(1)}s.`,
        });
      }
    }
  }
}

/** Periodic checks across all workflows: error-rate spikes and workflows that stopped running. */
export async function periodicWorkflowChecks(projectId: number): Promise<void> {
  const rates = all<{ platform: string; workflow_id: string; workflow_name: string; total: number; errors: number }>(
    `SELECT platform, workflow_id, MAX(workflow_name) AS workflow_name, COUNT(*) AS total,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM workflow_runs WHERE project_id = ? AND started_at >= ?
      GROUP BY platform, workflow_id`,
    projectId, new Date(Date.now() - 86400000).toISOString(),
  );
  for (const r of rates) {
    const dedupeKey = `wf:${r.platform}:${r.workflow_id}:error-rate`;
    if (r.total >= 5 && r.errors / r.total > 0.2) {
      await raiseIncident(projectId, {
        module: "workflows", code: "HIGH_ERROR_RATE", severity: "high",
        title: `"${r.workflow_name}" fails ${Math.round((r.errors / r.total) * 100)}% of the time`,
        detail: `${r.errors} of ${r.total} executions failed in the last 24 hours.`,
        dedupeKey,
      });
    } else if (r.total >= 5) {
      resolveIncidents(projectId, dedupeKey);
    }
  }

  const sources = all<{ id: number; platform: string; name: string; expected_interval_min: number | null }>(
    "SELECT id, platform, name, expected_interval_min FROM workflow_sources WHERE project_id = ? AND expected_interval_min IS NOT NULL",
    projectId,
  );
  for (const s of sources) {
    const last = get<{ started_at: string }>(
      "SELECT MAX(started_at) AS started_at FROM workflow_runs WHERE project_id = ? AND platform = ?", projectId, s.platform,
    );
    const lastMs = last?.started_at ? Date.parse(last.started_at) : 0;
    const limitMs = (s.expected_interval_min ?? 0) * 60000 * 1.5;
    if (limitMs > 0 && Date.now() - lastMs > limitMs) {
      await raiseIncident(projectId, {
        module: "workflows", code: "STALE", severity: "high",
        title: `No ${s.platform} runs from "${s.name}" recently`,
        detail: lastMs
          ? `Last execution was ${Math.round((Date.now() - lastMs) / 60000)} minutes ago; expected every ${s.expected_interval_min} minutes. A trigger may be broken or the workflow deactivated.`
          : `No executions recorded yet; expected every ${s.expected_interval_min} minutes.`,
        dedupeKey: `wfsource:${s.id}:stale`,
      });
    } else {
      resolveIncidents(projectId, `wfsource:${s.id}:stale`);
    }
  }
}
