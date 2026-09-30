import { AutoRefresh, SubmitButton } from "@/components/client";
import { isRunning } from "@/lib/tests/runner";
import { MAX_WA_QUESTIONS, wahaConfigured } from "@/lib/whatsapp";
import { Badge, Empty, Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { ownedProject } from "@/lib/projects";
import { addTargetAction, addWhatsAppTargetAction, addTestCaseAction, deleteTargetAction, deleteTestCaseAction, runTestsAction } from "../actions";

export const metadata = { title: "Chatbot tests" };

export default async function TestsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const flash = await searchParams;
  const targets = all<{ id: number; name: string; url: string; response_path: string; last_run_at: string | null; kind: string; phone: string | null }>(
    "SELECT id, name, url, response_path, last_run_at, kind, phone FROM bot_targets WHERE project_id = ? ORDER BY id", p.id,
  );
  const anyRunning = targets.some((t) => isRunning(t.id));
  const waReady = wahaConfigured();
  const cases = all<{ id: number; question: string; expected: string; must_not: string }>(
    "SELECT id, question, expected, must_not FROM test_cases WHERE project_id = ? ORDER BY id", p.id,
  );
  const runs = all<{ id: number; target: string; passed: number; failed: number; created_at: string }>(
    `SELECT r.id, t.name AS target, r.passed, r.failed, r.created_at FROM test_runs r JOIN bot_targets t ON t.id = r.target_id
      WHERE r.project_id = ? ORDER BY r.id DESC LIMIT 15`, p.id,
  );
  const results = runs.length
    ? all<{ run_id: number; question: string; answer: string; pass: number; reason: string }>(
        `SELECT run_id, question, answer, pass, reason FROM test_results WHERE run_id IN (${runs.map(() => "?").join(",")}) ORDER BY pass, id`,
        ...runs.map((r) => r.id),
      )
    : [];
  const pid = <input type="hidden" name="projectId" value={p.id} />;

  return (
    <div>
      <Flash {...flash} />
      <AutoRefresh active={anyRunning} ms={10000} />
      <PageHeader title="Chatbot tests" subtitle="Ask your bot the same important questions every night and get alerted when an answer breaks" />

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div><h3>1. Connect your bot</h3><span className="sub">Any bot with an HTTP endpoint: custom GPT backends, Chatbase, Voiceflow, Botpress, your own API.</span></div></div>
          {targets.map((t) => (
            <div key={t.id} className="card" style={{ boxShadow: "none", marginBottom: 12 }}>
              <div className="row between">
                <div style={{ minWidth: 0 }}>
                  <strong>{t.kind === "whatsapp" ? "📱" : "🤖"} {t.name}</strong>{isRunning(t.id) ? <> <Badge tone="warn">⏳ Testing now…</Badge></> : null}
                  <div className="faint mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.kind === "whatsapp" ? `WhatsApp +${t.phone}` : t.url}</div>
                  <div className="faint">Last run: {timeAgo(t.last_run_at)} · runs automatically every 24h{t.kind === "whatsapp" ? ` · first ${MAX_WA_QUESTIONS} questions` : ""}</div>
                </div>
                <div className="row">
                  <form action={runTestsAction}>{pid}<input type="hidden" name="targetId" value={t.id} /><SubmitButton className="btn btn-sm" pendingText="Testing…">▶ Run tests</SubmitButton></form>
                  <form action={deleteTargetAction}>{pid}<input type="hidden" name="targetId" value={t.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm={`Remove "${t.name}"?`}>Remove</SubmitButton></form>
                </div>
              </div>
            </div>
          ))}
          <details open={targets.length === 0}>
            <summary>📱 + Add a WhatsApp bot (just the number)</summary>
            {waReady ? (
              <form action={addWhatsAppTargetAction}>
                {pid}
                <p className="sub" style={{ marginTop: 8 }}>
                  ProofMyAI messages your bot on WhatsApp like a real customer, reads the reply and checks it against your expected facts.
                  Nothing to install, and it works with any WhatsApp bot (WhatsApp Business API, WATI, Interakt, WAHA, n8n, ManyChat…).
                </p>
                <div className="field"><label htmlFor="waname">Name</label><input id="waname" name="name" type="text" placeholder="WhatsApp support bot" /></div>
                <div className="field"><label htmlFor="waphone">Bot&apos;s WhatsApp number (with country code)</label><input id="waphone" name="phone" type="tel" required placeholder="+92 300 1234567" inputMode="tel" autoComplete="off" /></div>
                <p className="faint">Up to {MAX_WA_QUESTIONS} test questions per run, once a night. The test chats appear in your WhatsApp inbox like any customer chat. If your bot creates a lead or ticket for every new chat, tag or ignore our number.</p>
                <label className="check"><input type="checkbox" name="confirm" value="1" required /> This is my own bot&apos;s number (or I have permission to test it).</label>
                <div style={{ marginTop: 10 }}><SubmitButton pendingText="Checking number…">Connect WhatsApp bot</SubmitButton></div>
              </form>
            ) : <p className="sub" style={{ marginTop: 8 }}>WhatsApp testing by number is coming soon. Meanwhile, monitor your WhatsApp bot&apos;s real conversations from <strong>Live tracking</strong>.</p>}
          </details>
          <details>
            <summary>+ Add a bot endpoint</summary>
            <form action={addTargetAction}>
              {pid}
              <p className="alert alert-warn" style={{ marginTop: 8 }}>
                Use a <strong>test or staging endpoint</strong> that returns the bot&apos;s answer, never a live channel webhook
                (Twilio/WhatsApp, Messenger, SMS). Tests send real questions, so a live webhook would open real cases or message real people.
                No test endpoint? Ask your developer for a simple &quot;dry-run&quot; URL, or use chat uploads and live tracking instead.
              </p>
              <div className="field"><label htmlFor="tname">Name</label><input id="tname" name="name" type="text" placeholder="Website support bot" /></div>
              <div className="field"><label htmlFor="url">Endpoint URL (POST)</label><input id="url" name="url" type="url" required placeholder="https://api.yourbot.com/chat" /></div>
              <div className="field">
                <label htmlFor="body">Request body <span className="hint">(JSON, use {"{{question}}"} where the question goes)</span></label>
                <textarea id="body" name="body_template" className="mono" defaultValue={'{"message": "{{question}}"}'} style={{ minHeight: 70 }} />
              </div>
              <div className="field">
                <label htmlFor="rpath">Answer location in the response <span className="hint">(dot path, e.g. <code>reply</code> or <code>choices.0.message.content</code>; empty = whole response)</span></label>
                <input id="rpath" name="response_path" type="text" placeholder="reply" />
              </div>
              <div className="field">
                <label htmlFor="headers">Headers <span className="hint">(optional JSON, stored encrypted)</span></label>
                <textarea id="headers" name="headers" className="mono" placeholder={'{"Authorization": "Bearer your-bot-key"}'} style={{ minHeight: 60 }} />
              </div>
              <SubmitButton pendingText="Saving…">Save bot</SubmitButton>
            </form>
          </details>
        </div>

        <div className="card">
          <div className="card-head">
            <div><h3>2. Test questions</h3><span className="sub">Real questions customers ask, with the facts a correct answer must contain.</span></div>
            <Badge tone={cases.length ? "ok" : "warn"}>{cases.length}</Badge>
          </div>
          <form action={addTestCaseAction}>
            {pid}
            <div className="field"><label htmlFor="q">Question</label><input id="q" name="question" type="text" required placeholder="What is your refund policy?" /></div>
            <div className="field"><label htmlFor="exp">Must include <span className="hint">(one fact per line)</span></label><textarea id="exp" name="expected" required placeholder={"refund within 30 days\noriginal payment method"} style={{ minHeight: 70 }} /></div>
            <div className="field"><label htmlFor="mn">Must NOT say <span className="hint">(optional, one per line)</span></label><textarea id="mn" name="must_not" placeholder={"lifetime guarantee\nno questions asked"} style={{ minHeight: 60 }} /></div>
            <SubmitButton pendingText="Adding…">Add question</SubmitButton>
          </form>
          {cases.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr><th>Question</th><th>Must include</th><th /></tr></thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id}>
                      <td className="cell-text">{c.question}</td>
                      <td className="sub cell-text" style={{ whiteSpace: "pre-wrap" }}>{c.expected}</td>
                      <td><form action={deleteTestCaseAction}>{pid}<input type="hidden" name="caseId" value={c.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">✕</SubmitButton></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Recent test runs</h3></div>
        {runs.length === 0 ? <Empty icon="🧪" title="No test runs yet">Connect a bot, add a few questions, then click “Run tests”.</Empty> : (
          runs.map((r) => (
            <details key={r.id} open={r.id === runs[0].id}>
              <summary>
                <span className="row" style={{ display: "inline-flex" }}>
                  {r.failed ? <Badge tone="bad">{r.failed} failed</Badge> : <Badge tone="ok">all passed</Badge>}
                  <span>{r.target} · {r.passed}/{r.passed + r.failed} passed · <span className="faint">{timeAgo(r.created_at)}</span></span>
                </span>
              </summary>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Result</th><th>Question</th><th>Bot answer</th><th>Why</th></tr></thead>
                  <tbody>
                    {results.filter((x) => x.run_id === r.id).map((x, i) => (
                      <tr key={i}>
                        <td>{x.pass ? <Badge tone="ok">Pass</Badge> : <Badge tone="bad">Fail</Badge>}</td>
                        <td className="cell-text">{x.question}</td>
                        <td className="cell-text sub"><div className="clamp">{x.answer || "–"}</div></td>
                        <td className="cell-text">{x.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
