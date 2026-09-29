import Link from "next/link";
import { ActivityChart } from "@/components/charts";
import { PageHeader, ScoreBadge, ScoreRing, SeverityBadge, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { projectHealth } from "@/lib/health";
import { llmAvailable } from "@/lib/judge/llm";
import { ownedProject } from "@/lib/projects";
import { userHasGivenFeedback } from "@/lib/testimonials";
import { cookies } from "next/headers";
import { dismissFeedbackPromptAction } from "../../feedback/actions";

export const metadata = { title: "Overview" };

export default async function Overview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const { welcome } = await searchParams;
  const h = projectHealth(p.id);
  const base = `/app/p/${p.id}`;
  const incidents = all<{ id: number; severity: string; title: string; detail: string; module: string; created_at: string }>(
    "SELECT id, severity, title, detail, module, created_at FROM incidents WHERE project_id = ? AND resolved = 0 ORDER BY id DESC LIMIT 6", p.id,
  );
  const count = (sql: string) => get<{ n: number }>(sql, p.id)?.n ?? 0;
  const steps = [
    { done: count("SELECT COUNT(*) AS n FROM kb_docs WHERE project_id = ?") > 0, text: "Add your help articles (knowledge base)", href: `${base}/chatbot` },
    { done: count("SELECT COUNT(*) AS n FROM audits WHERE project_id = ?") > 0, text: "Run your first chatbot audit", href: `${base}/chatbot` },
    { done: count("SELECT COUNT(*) AS n FROM test_cases WHERE project_id = ?") > 0, text: "Add nightly test questions for your bot", href: `${base}/tests` },
    { done: count("SELECT COUNT(*) AS n FROM agent_runs WHERE project_id = ?") > 0, text: "Send your first AI agent run", href: `${base}/agents` },
    { done: count("SELECT COUNT(*) AS n FROM workflow_runs WHERE project_id = ?") > 0, text: "Connect n8n or Make", href: `${base}/workflows` },
    { done: Boolean(p.alert_webhook || p.alert_email), text: "Turn on Slack/Discord/email alerts", href: `${base}/settings` },
  ];
  const doneSteps = steps.filter((s) => s.done).length;
  const daysSinceSignup = (Date.now() - new Date(`${get<{ c: string }>("SELECT created_at AS c FROM users WHERE id = ?", user.id)?.c ?? ""}Z`).getTime()) / 86400000;
  const askFeedback = doneSteps >= 1 && daysSinceSignup >= 3 && !(await cookies()).get("pma_fb_dismissed") && !userHasGivenFeedback(user.id);
  const moduleLinks = { chatbot: `${base}/chatbot`, tests: `${base}/tests`, agents: `${base}/agents`, workflows: `${base}/workflows` } as const;

  return (
    <div>
      {welcome ? <div className="alert alert-info">Welcome to ProofMyAI! Follow the checklist below. Each step takes about 2 minutes. The <Link href={`${base}/guide`}>setup guide</Link> has click-by-click help.</div> : null}
      {!llmAvailable() ? (
        <div className="alert alert-warn">Running in <strong>basic mode</strong> (rule-based checks and the neural model). Add a <code>GEMINI_API_KEY</code> (free tier available) or <code>ANTHROPIC_API_KEY</code> to the server to turn on the AI judge.</div>
      ) : null}
      {askFeedback ? (
        <div className="alert alert-info row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <span>⭐ You&apos;ve been using ProofMyAI for a few days. Is it useful? Two minutes of honest feedback helps a lot.</span>
          <span className="row">
            <Link href="/app/feedback" className="btn btn-sm">Share feedback</Link>
            <form action={dismissFeedbackPromptAction}><input type="hidden" name="back" value={base} /><button className="btn btn-ghost btn-sm">Not now</button></form>
          </span>
        </div>
      ) : null}
      <PageHeader title={p.name} subtitle="Health of every AI system in this project" />

      <div className="grid grid-hero">
        <div className="card" style={{ display: "grid", placeItems: "center", textAlign: "center" }}>
          <ScoreRing score={h.overall} size={170} />
          <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>
            {h.overall == null ? "Connect a module to get your score" : h.highIncidents ? `${h.highIncidents} high-severity incident${h.highIncidents > 1 ? "s" : ""} open` : "No high-severity incidents"}
          </p>
        </div>
        <div className="card">
          <div className="card-head">
            <div><h3>Last 14 days</h3><span className="sub">Workflow executions and average agent score</span></div>
          </div>
          <ActivityChart series={h.series} />
        </div>
      </div>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        {(Object.keys(h.modules) as (keyof typeof h.modules)[]).map((k) => (
          <Link key={k} href={moduleLinks[k]} className="card stat" style={{ color: "inherit", textDecoration: "none" }}>
            <span className="stat-label">{h.modules[k].label}</span>
            <span className="stat-value">{h.modules[k].score == null ? "–" : `${h.modules[k].score}%`}</span>
            <div className="progress"><span style={{ width: `${h.modules[k].score ?? 0}%` }} /></div>
            <span className="stat-foot">{h.modules[k].detail}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3>Open incidents</h3>
            <Link href={`${base}/incidents`} className="btn btn-ghost btn-sm">View all</Link>
          </div>
          {incidents.length === 0 ? (
            <p className="sub">🎉 Nothing needs your attention right now.</p>
          ) : (
            <div className="stack">
              {incidents.map((i) => (
                <div key={i.id} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <SeverityBadge severity={i.severity} />
                  <div style={{ minWidth: 0 }}>
                    <strong>{i.title}</strong>
                    <div className="sub clamp">{i.detail}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{i.module} · {timeAgo(i.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Getting started</h3>
            <ScoreBadge score={Math.round((doneSteps / steps.length) * 100)} />
          </div>
          <ul className="checklist">
            {steps.map((s) => (
              <li key={s.text}>
                <span className={`tick ${s.done ? "done" : ""}`}>✓</span>
                <Link href={s.href} style={{ color: s.done ? "var(--faint)" : "var(--text)", textDecoration: s.done ? "line-through" : "none" }}>{s.text}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
