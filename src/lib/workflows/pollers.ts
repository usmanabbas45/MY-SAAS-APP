import { scheduledIds } from "../billing";
import { all, run } from "../db";
import { decrypt, safeFetch } from "../security";
import { recordWorkflowRun, type WorkflowRunInput } from "./monitor";

interface Source {
  id: number;
  project_id: number;
  platform: "n8n" | "make";
  base_url: string;
  api_key_enc: string;
  scenario_ids: string;
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await safeFetch(url, { headers: { accept: "application/json", ...headers } }, 20000);
  if (res.status === 401 || res.status === 403) throw new Error(`Access denied (${res.status}) - check the API key`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

type N8nExecution = { id: string | number; workflowId: string | number; status?: string; finished?: boolean; startedAt?: string; stoppedAt?: string | null };

/** Maps an n8n execution (public API v1) to ProofMyAI's run format. Exported for tests. */
export function mapN8nExecution(e: N8nExecution, names: Map<string, string>): WorkflowRunInput | null {
  const status = e.status ?? (e.finished ? "success" : "error");
  if (status === "running" || status === "waiting" || status === "new") return null;
  const started = e.startedAt ? Date.parse(e.startedAt) : NaN;
  const stopped = e.stoppedAt ? Date.parse(e.stoppedAt) : NaN;
  return {
    platform: "n8n",
    workflow_id: String(e.workflowId),
    workflow_name: names.get(String(e.workflowId)) ?? `Workflow ${e.workflowId}`,
    execution_id: String(e.id),
    status: status === "success" ? "success" : status === "canceled" ? "cancelled" : "error",
    started_at: Number.isFinite(started) ? new Date(started).toISOString() : undefined,
    duration_ms: Number.isFinite(started) && Number.isFinite(stopped) ? Math.max(0, stopped - started) : null,
    error_message: status === "success" ? null : `n8n execution status: ${status}`,
  };
}

async function pollN8n(src: Source): Promise<number> {
  const base = src.base_url.replace(/\/+$/, "");
  const headers = { "X-N8N-API-KEY": decrypt(src.api_key_enc) };
  const wf = (await getJson(`${base}/api/v1/workflows?limit=250`, headers)) as { data?: { id: string; name: string }[] };
  const names = new Map((wf.data ?? []).map((w) => [String(w.id), w.name]));
  const ex = (await getJson(`${base}/api/v1/executions?limit=100&includeData=false`, headers)) as { data?: N8nExecution[] };
  let added = 0;
  for (const e of ex.data ?? []) {
    const mapped = mapN8nExecution(e, names);
    if (mapped && (await recordWorkflowRun(src.project_id, mapped))) added++;
  }
  return added;
}

type MakeLog = { id?: string; imtId?: string; status?: number; timestamp?: string; duration?: number; operations?: number };

/** Maps a Make scenario log entry (API v2, status 1=success 2=warning 3=error). Exported for tests. */
export function mapMakeLog(scenarioId: string, log: MakeLog): WorkflowRunInput | null {
  const executionId = log.imtId ?? log.id;
  if (!executionId) return null;
  const status = log.status === 1 ? "success" : log.status === 2 ? "warning" : log.status === 3 ? "error" : null;
  if (!status) return null;
  return {
    platform: "make",
    workflow_id: scenarioId,
    workflow_name: `Scenario ${scenarioId}`,
    execution_id: String(executionId),
    status,
    started_at: log.timestamp ? new Date(log.timestamp).toISOString() : undefined,
    duration_ms: typeof log.duration === "number" ? log.duration : null,
    error_message: status === "error" ? "Make scenario run ended in an error" : null,
  };
}

async function pollMake(src: Source): Promise<number> {
  const base = src.base_url.replace(/\/+$/, "");
  const headers = { Authorization: `Token ${decrypt(src.api_key_enc)}` };
  let added = 0;
  for (const scenarioId of src.scenario_ids.split(/[\s,]+/).filter(Boolean)) {
    const scenario = (await getJson(`${base}/api/v2/scenarios/${encodeURIComponent(scenarioId)}`, headers)) as { scenario?: { name?: string } };
    const logs = (await getJson(`${base}/api/v2/scenarios/${encodeURIComponent(scenarioId)}/logs?pg%5Blimit%5D=50`, headers)) as { scenarioLogs?: MakeLog[] };
    for (const log of logs.scenarioLogs ?? []) {
      const mapped = mapMakeLog(scenarioId, log);
      if (!mapped) continue;
      if (scenario.scenario?.name) mapped.workflow_name = scenario.scenario.name;
      if (await recordWorkflowRun(src.project_id, mapped)) added++;
    }
  }
  return added;
}

export async function pollSource(src: Source): Promise<{ added: number; error: string | null }> {
  try {
    const added = src.platform === "n8n" ? await pollN8n(src) : await pollMake(src);
    run("UPDATE workflow_sources SET last_polled_at = datetime('now'), last_error = NULL WHERE id = ?", src.id);
    return { added, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    run("UPDATE workflow_sources SET last_polled_at = datetime('now'), last_error = ? WHERE id = ?", error, src.id);
    return { added: 0, error };
  }
}

export async function pollAllSources(projectId?: number): Promise<void> {
  const sources = projectId
    ? all<Source>("SELECT * FROM workflow_sources WHERE project_id = ?", projectId)
    : all<Source>("SELECT * FROM workflow_sources");
  const allowed = projectId ? null : scheduledIds("sources");
  for (const s of sources) if (!allowed || allowed.has(s.id)) await pollSource(s);
}
