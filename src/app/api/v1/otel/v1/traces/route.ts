import { ingestAgentRun } from "@/lib/agents/ingest";
import { collectRuns, type OtlpTraces } from "@/lib/agents/otel";
import { json, readIngest } from "@/lib/api";
import { limitError, projectOwner } from "@/lib/billing";
import { get } from "@/lib/db";

/**
 * OpenTelemetry OTLP/HTTP endpoint for AI agent traces. Point any OTel exporter here:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://proofmyai.com/api/v1/otel
 *   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer ap_live_...
 *   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
 * Each finished trace becomes an agent run with the usual checks (errors, loops, cost, latency, empty output).
 */
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("protobuf")) {
    return json({ error: "Send OTLP as JSON: set OTEL_EXPORTER_OTLP_PROTOCOL=http/json (or OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json)." }, 415);
  }
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const runs = collectRuns(r.project.id, (r.body ?? {}) as OtlpTraces);
  const owner = projectOwner(r.project.id);
  let rejected = 0;
  let error = "";
  for (const run of runs) {
    if (!get("SELECT 1 FROM agent_runs a JOIN projects p ON p.id = a.project_id WHERE p.user_id = ? AND a.agent_name = ?", owner, run.agent_name)) {
      const over = limitError(owner, "monitors");
      if (over) { rejected++; error = over; continue; }
    }
    const result = await ingestAgentRun(r.project.id, run);
    if (!result.ok && result.status !== 409) { rejected++; error = result.error; } // 409: an exporter retry of a trace we already have
  }
  // OTLP success response; rejected runs are reported as a partial success so exporters don't retry forever.
  return json(rejected ? { partialSuccess: { rejectedSpans: rejected, errorMessage: error } } : { partialSuccess: {} }, 200);
}
