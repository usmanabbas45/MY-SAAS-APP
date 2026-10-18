import Link from "next/link";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { projectAccess } from "@/lib/projects";
import { AUTOPILOT_AT, MIN_EVIDENCE, SPOT_CHECK_AT, trustReport, type Autonomy } from "@/lib/trust";

export const metadata = { title: "AI trust report" };

const LEVEL: Record<Autonomy, { label: string; tone: "ok" | "info" | "bad" | "muted"; icon: string }> = {
  autopilot: { label: "Can decide alone", tone: "ok", icon: "🟢" },
  spot_check: { label: "Decide + weekly spot check", tone: "info", icon: "🟡" },
  human_review: { label: "Human must approve", tone: "bad", icon: "🔴" },
  not_enough_data: { label: "Not enough evidence yet", tone: "muted", icon: "⚪" },
};

export default async function TrustPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { project: p } = projectAccess(user.id, Number((await params).id));
  const t = trustReport(p.id, 30);
  const base = `/app/p/${p.id}`;
  const latestAudit = get<{ id: number }>("SELECT id FROM audits WHERE project_id = ? AND status IN ('done', 'live') ORDER BY id DESC LIMIT 1", p.id)?.id;
  const reviewHref = latestAudit ? `${base}/chatbot/audit/${latestAudit}` : `${base}/chatbot`;
  const human = t.humanCheck;
  const counts = (a: Autonomy) => t.areas.filter((x) => x.autonomy === a).length;

  return (
    <div>
      <PageHeader title="AI trust report" subtitle="Where your AI can be trusted to decide on its own, and where a person should still check, backed by evidence from the last 30 days" />

      {t.answers === 0 ? (
        <Empty icon="🛡️" title="No evidence yet">
          Trust is earned with evidence. <Link href={`${base}/connect`}>Connect your chatbot or AI agent</Link> or <Link href={`${base}/chatbot`}>run an audit</Link>, and this page shows, topic by topic, where your AI can decide alone.
        </Empty>
      ) : (
        <>
          <div className="grid grid-4">
            <Stat label="Trust score" value={t.score == null ? "–" : `${t.score}/100`} foot={t.score == null ? `needs ${MIN_EVIDENCE}+ checked answers` : "proven accuracy, 95% confidence"} />
            <Stat label="Can decide alone" value={t.autopilotShare == null ? "–" : `${t.autopilotShare}%`} foot="of decisions, by volume" />
            <Stat label="Need a human" value={counts("human_review")} foot={`area${counts("human_review") === 1 ? "" : "s"} below ${Math.round(SPOT_CHECK_AT * 100)}% proven`} />
            <Stat label="Your team agrees with ProofMyAI" value={human.agreement == null ? "–" : `${human.agreement}%`} foot={human.reviewed ? `${human.reviewed} verdicts reviewed` : "no reviews yet"} />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><div><h3>Decisions your AI can be trusted with</h3><span className="sub">{t.answers.toLocaleString("en-GB")} answers and agent runs checked in the last {t.days} days</span></div></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Area</th><th>Checked</th><th>Right</th><th>Proven</th><th>Serious mistakes</th><th>Recommendation</th></tr></thead>
              <tbody>
                {t.areas.map((a) => {
                  const l = LEVEL[a.autonomy];
                  return (
                    <tr key={`${a.kind}:${a.area}`}>
                      <td><strong>{a.area}</strong><div className="sub">{a.why}</div></td>
                      <td>{a.total}</td>
                      <td>{a.accuracy}%</td>
                      <td><strong>{a.autonomy === "not_enough_data" ? "–" : `${a.proven}%`}</strong></td>
                      <td style={a.serious ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{a.serious}</td>
                      <td><Badge tone={l.tone}>{l.icon} {l.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <p className="faint" style={{ fontSize: 13, marginTop: 10 }}>
              <b>Proven</b> is the accuracy ProofMyAI can promise with 95% confidence for the amount of evidence so far: 19 right out of 20 proves less than 950 out of 1,000.
              {" "}🟢 needs {Math.round(AUTOPILOT_AT * 100)}%+ proven and no serious mistakes, 🟡 {Math.round(SPOT_CHECK_AT * 100)}%+, otherwise 🔴. Every area needs {MIN_EVIDENCE}+ checks before it's rated.
            </p>
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="card-head"><div><h3>✋ Who checks the checker?</h3><span className="sub">Trust ProofMyAI's verdicts only as far as your team confirms them</span></div></div>
              {human.reviewed >= 20 ? (
                <p>Your team reviewed <b>{human.reviewed}</b> of ProofMyAI's verdicts and agreed with <b>{human.agreement}%</b>.{human.agreement != null && human.agreement < 90 ? " That's below 90%: add the missing facts to your help docs and rules so the checks match your business." : " Keep reviewing a few each week to keep this honest."}</p>
              ) : (
                <p>Review at least <b>20</b> verdicts ({human.reviewed} so far): open an audit and click <b>Agree</b> or pick the right verdict on each answer. ProofMyAI learns from your corrections and this page shows how often it matches your judgement.</p>
              )}
              <Link className="btn btn-sm" href={reviewHref}>Review answers now</Link>
            </div>
            <div className="card">
              <div className="card-head"><div><h3>🛑 Stop bad decisions before they happen</h3><span className="sub">Pre-send check for chatbots and AI agents</span></div></div>
              <p>Before your AI sends a reply or acts on it (a refund, a discount, a booking), send it to <code>POST /api/v1/check</code>. You get <Badge tone="ok">allow</Badge> <Badge tone="info">review</Badge> or <Badge tone="bad">block</Badge> with the reason in a few seconds, so customers never see a made-up answer. Areas marked 🔴 above always return <b>review</b>.</p>
              <Link className="btn btn-ghost btn-sm" href="/docs#check">How to add the check</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
