import { all, get } from "./db";

export interface ModuleHealth {
  score: number | null; // null = module not set up yet
  label: string;
  detail: string;
}

export interface DayPoint {
  day: string; // YYYY-MM-DD
  workflowRuns: number;
  workflowErrors: number;
  agentRuns: number;
  agentAvgScore: number | null;
}

export interface ProjectHealth {
  overall: number | null;
  modules: Record<"chatbot" | "tests" | "agents" | "workflows", ModuleHealth>;
  openIncidents: number;
  highIncidents: number;
  series: DayPoint[];
}

const WEIGHTS = { chatbot: 0.3, tests: 0.2, agents: 0.25, workflows: 0.25 } as const;

export function weightedOverall(scores: Partial<Record<keyof typeof WEIGHTS, number | null>>): number | null {
  let total = 0;
  let weight = 0;
  for (const [k, w] of Object.entries(WEIGHTS) as [keyof typeof WEIGHTS, number][]) {
    const s = scores[k];
    if (s == null) continue;
    total += s * w;
    weight += w;
  }
  return weight === 0 ? null : Math.round(total / weight);
}

export function projectHealth(projectId: number, days = 14): ProjectHealth {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();

  const audit = get<{ score: number; created_at: string; name: string }>(
    "SELECT score, created_at, name FROM audits WHERE project_id = ? AND status IN ('done', 'live') AND score IS NOT NULL ORDER BY id DESC LIMIT 1", projectId,
  );
  const test = get<{ passed: number; failed: number; created_at: string }>(
    "SELECT passed, failed, created_at FROM test_runs WHERE project_id = ? ORDER BY id DESC LIMIT 1", projectId,
  );
  const agents = get<{ n: number; avg: number | null }>(
    "SELECT COUNT(*) AS n, AVG(score) AS avg FROM agent_runs WHERE project_id = ? AND created_at >= datetime('now', '-7 days')", projectId,
  );
  const wf = get<{ n: number; ok: number | null }>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN status IN ('success','warning') THEN 1 ELSE 0 END) AS ok
       FROM workflow_runs WHERE project_id = ? AND started_at >= ? AND status NOT IN ('running','waiting','cancelled')`,
    projectId, since,
  );

  const modules: ProjectHealth["modules"] = {
    chatbot: audit
      ? { score: Math.round(audit.score), label: "Chatbot accuracy", detail: `Latest audit "${audit.name}"` }
      : { score: null, label: "Chatbot accuracy", detail: "Run your first audit" },
    tests: test
      ? { score: Math.round((test.passed / Math.max(1, test.passed + test.failed)) * 100), label: "Test pass rate", detail: `${test.passed}/${test.passed + test.failed} passing` }
      : { score: null, label: "Test pass rate", detail: "Add a bot endpoint and tests" },
    agents: agents && agents.n > 0
      ? { score: Math.round(agents.avg ?? 0), label: "Agent reliability", detail: `${agents.n} runs in 7 days` }
      : { score: null, label: "Agent reliability", detail: "Send your first agent run" },
    workflows: wf && wf.n > 0
      ? { score: Math.round(((wf.ok ?? 0) / wf.n) * 100), label: "Workflow success", detail: `${wf.n} executions in 7 days` }
      : { score: null, label: "Workflow success", detail: "Connect n8n or Make" },
  };

  const incidents = get<{ open: number; high: number | null }>(
    "SELECT COUNT(*) AS open, SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high FROM incidents WHERE project_id = ? AND resolved = 0",
    projectId,
  );

  const wfDays = all<{ day: string; n: number; errors: number }>(
    `SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS n, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM workflow_runs WHERE project_id = ? AND started_at >= ? GROUP BY day`,
    projectId, new Date(Date.now() - days * 86400000).toISOString(),
  );
  const agentDays = all<{ day: string; n: number; avg: number }>(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n, AVG(score) AS avg
       FROM agent_runs WHERE project_id = ? AND created_at >= datetime('now', ?) GROUP BY day`,
    projectId, `-${days} days`,
  );
  const series: DayPoint[] = Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
    const w = wfDays.find((d) => d.day === day);
    const a = agentDays.find((d) => d.day === day);
    return { day, workflowRuns: w?.n ?? 0, workflowErrors: w?.errors ?? 0, agentRuns: a?.n ?? 0, agentAvgScore: a ? Math.round(a.avg) : null };
  });

  return {
    overall: weightedOverall({
      chatbot: modules.chatbot.score, tests: modules.tests.score, agents: modules.agents.score, workflows: modules.workflows.score,
    }),
    modules,
    openIncidents: incidents?.open ?? 0,
    highIncidents: incidents?.high ?? 0,
    series,
  };
}
