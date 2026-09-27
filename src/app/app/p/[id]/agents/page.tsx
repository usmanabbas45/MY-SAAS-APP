import { CopyButton } from "@/components/client";
import { Sparkline } from "@/components/charts";
import { Badge, Empty, PageHeader, ScoreBadge, SeverityBadge, Stat, StatusBadge, timeAgo } from "@/components/ui";
import type { AgentStep, Issue } from "@/lib/agents/checks";
import { requireUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { ownedProject } from "@/lib/projects";
import { agentSnippets } from "@/lib/snippets";
import { truncate } from "@/lib/text";

export const metadata = { title: "AI agents" };

export default async function AgentsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const runs = all<{ id: number; external_id: string; agent_name: string; goal: string; status: string; final_output: string; steps_json: string; total_cost_usd: number; total_ms: number; issues_json: string; score: number; created_at: string }>(
    "SELECT * FROM agent_runs WHERE project_id = ? ORDER BY id DESC LIMIT 50", p.id,
  );
  const week = get<{ n: number; avg: number | null; cost: number | null; failed: number | null }>(
    `SELECT COUNT(*) AS n, AVG(score) AS avg, SUM(total_cost_usd) AS cost, SUM(CASE WHEN score < 65 THEN 1 ELSE 0 END) AS failed
       FROM agent_runs WHERE project_id = ? AND created_at >= datetime('now', '-7 days')`, p.id,
  );
  const perAgent = all<{ agent_name: string; n: number; avg: number; cost: number }>(
    `SELECT agent_name, COUNT(*) AS n, AVG(score) AS avg, SUM(total_cost_usd) AS cost FROM agent_runs
      WHERE project_id = ? AND created_at >= datetime('now', '-30 days') GROUP BY agent_name ORDER BY n DESC`, p.id,
  );
  const trend = all<{ score: number }>("SELECT score FROM agent_runs WHERE project_id = ? ORDER BY id DESC LIMIT 30", p.id).map((r) => r.score).reverse();
  const snippets = agentSnippets(process.env.APP_URL || "http://localhost:3000", p.api_key);

  return (
    <div>
      <PageHeader title="AI agents" subtitle="Every agent run is checked for loops, tool errors, runaway cost, empty output and unsupported claims" />
      <div className="grid grid-4">
        <Stat label="Runs (7 days)" value={week?.n ?? 0} foot={<Sparkline values={trend} color="var(--ok)" />} />
        <Stat label="Average score" value={week?.avg == null ? "–" : Math.round(week.avg)} foot="100 = no issues" />
        <Stat label="Problem runs" value={week?.failed ?? 0} foot="score below 65" />
        <Stat label="Spend (7 days)" value={`$${(week?.cost ?? 0).toFixed(2)}`} foot={`budget per run $${p.agent_cost_budget_usd.toFixed(2)}`} />
      </div>

      {perAgent.length > 0 ? (
        <div className="card">
          <h3>Agents (30 days)</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Agent</th><th>Runs</th><th>Avg score</th><th>Total cost</th><th>Cost / run</th></tr></thead>
              <tbody>
                {perAgent.map((a) => (
                  <tr key={a.agent_name}>
                    <td><strong>{a.agent_name}</strong></td><td>{a.n}</td><td><ScoreBadge score={a.avg} /></td>
                    <td>${a.cost.toFixed(2)}</td><td>${(a.cost / a.n).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head"><h3>Recent runs</h3></div>
        {runs.length === 0 ? (
          <Empty icon="🤖" title="No agent runs yet">Add one HTTP call at the end of your agent (code below). Runs appear here instantly.</Empty>
        ) : runs.map((r) => {
          const issues = JSON.parse(r.issues_json) as Issue[];
          const steps = JSON.parse(r.steps_json) as AgentStep[];
          const shown = issues.filter((i) => i.code !== "AI_REVIEW_PASSED");
          return (
            <details key={r.id}>
              <summary>
                <span className="row" style={{ display: "inline-flex" }}>
                  <ScoreBadge score={r.score} /><StatusBadge status={r.status} />
                  <strong>{r.agent_name}</strong>
                  <span className="faint">{r.external_id} · {steps.length} steps · ${r.total_cost_usd.toFixed(4)} · {(r.total_ms / 1000).toFixed(1)}s · {timeAgo(r.created_at)}</span>
                  {shown.slice(0, 3).map((i) => <Badge key={i.code} tone={i.severity === "high" ? "bad" : i.severity === "medium" ? "warn" : "info"}>{i.code.replace(/_/g, " ").toLowerCase()}</Badge>)}
                </span>
              </summary>
              {r.goal ? <p><strong>Goal:</strong> {r.goal}</p> : null}
              <p><strong>Output:</strong> {r.final_output ? truncate(r.final_output, 1200) : <em className="faint">(empty)</em>}</p>
              {issues.length ? (
                <div className="stack" style={{ marginBottom: 12 }}>
                  {issues.map((i, n) => <div key={n} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><SeverityBadge severity={i.code === "AI_REVIEW_PASSED" ? "none" : i.severity} /><span>{i.message}</span></div>)}
                </div>
              ) : <p className="sub">✅ No issues found.</p>}
              {steps.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>#</th><th>Type</th><th>Name</th><th>Result</th><th>Time</th><th>Cost</th></tr></thead>
                    <tbody>
                      {steps.slice(0, 100).map((s, i) => (
                        <tr key={i}>
                          <td className="faint">{i + 1}</td><td><Badge>{s.type}</Badge></td><td>{s.name}</td>
                          <td className="cell-text">{s.error ? <span style={{ color: "var(--bad)" }}>✕ {truncate(s.error, 200)}</span> : <span className="sub">{truncate(JSON.stringify(s.output ?? ""), 160)}</span>}</td>
                          <td className="faint">{s.duration_ms ? `${(s.duration_ms / 1000).toFixed(1)}s` : "–"}</td>
                          <td className="faint">{s.cost_usd ? `$${s.cost_usd.toFixed(4)}` : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </details>
          );
        })}
      </div>

      <div className="card">
        <div className="card-head"><div><h3>Connect an agent</h3><span className="sub">Send the run when your agent finishes. Only <code>run_id</code> and <code>agent_name</code> are required. Add a <code>goal</code> to get the AI review.</span></div></div>
        {(["curl", "js", "python"] as const).map((k) => (
          <div key={k} style={{ marginBottom: 12 }}>
            <div className="row between" style={{ marginBottom: 6 }}><strong>{k === "js" ? "JavaScript / TypeScript" : k === "python" ? "Python" : "cURL"}</strong><CopyButton text={snippets[k]} /></div>
            <pre>{snippets[k]}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
