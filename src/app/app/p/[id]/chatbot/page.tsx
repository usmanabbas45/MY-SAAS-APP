import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Badge, Empty, Flash, PageHeader, ScoreBadge, StatusBadge, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { judgeProvider, llmAvailable } from "@/lib/judge/llm";
import { ownedProject } from "@/lib/projects";
import { addKbDocAction, deleteAuditAction, deleteKbDocAction, startAuditAction } from "../actions";

export const metadata = { title: "Chatbot audits" };

const SAMPLE_CSV = `conversation_id,role,message
1,customer,How long does shipping take?
1,bot,Standard shipping takes 3-7 business days.
2,customer,I want a refund or I'm calling my lawyer
2,bot,Have a great day!`;

export default async function ChatbotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const flash = await searchParams;
  const docs = all<{ id: number; title: string; chars: number; updated_at: string }>(
    "SELECT id, title, LENGTH(content) AS chars, updated_at FROM kb_docs WHERE project_id = ? ORDER BY id DESC", p.id,
  );
  const audits = all<{ id: number; name: string; mode: string; status: string; score: number | null; created_at: string; items: number; problems: number }>(
    `SELECT a.id, a.name, a.mode, a.status, a.score, a.created_at,
            (SELECT COUNT(*) FROM audit_items i WHERE i.audit_id = a.id) AS items,
            (SELECT COUNT(*) FROM audit_items i WHERE i.audit_id = a.id AND COALESCE(i.corrected_verdict, i.verdict) <> 'correct') AS problems
       FROM audits a WHERE a.project_id = ? ORDER BY a.id DESC`, p.id,
  );

  return (
    <div>
      <Flash {...flash} />
      <PageHeader title="Chatbot audits" subtitle="Grade every answer your chatbot gave against your own help docs" />

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>1. Knowledge base</h3>
              <span className="sub">The truth your bot should follow: FAQs, policies, prices, help articles.</span>
            </div>
            <Badge tone={docs.length ? "ok" : "warn"}>{docs.length} article{docs.length === 1 ? "" : "s"}</Badge>
          </div>
          <form action={addKbDocAction}>
            <input type="hidden" name="projectId" value={p.id} />
            <div className="field">
              <label htmlFor="files">Upload files <span className="hint">(.txt or .md, several at once)</span></label>
              <input id="files" name="files" type="file" multiple accept=".txt,.md,.markdown,.csv,.html,text/plain,text/markdown" />
            </div>
            <details>
              <summary>…or paste an article</summary>
              <div className="field">
                <label htmlFor="title">Title</label>
                <input id="title" name="title" type="text" placeholder="Refund policy" maxLength={200} />
              </div>
              <div className="field">
                <label htmlFor="content">Content</label>
                <textarea id="content" name="content" placeholder="Customers can request a refund within 30 days…" />
              </div>
            </details>
            <div style={{ marginTop: 12 }}><SubmitButton pendingText="Saving…">Add to knowledge base</SubmitButton></div>
          </form>
          {docs.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td>📄 {d.title}</td>
                      <td className="faint">{Math.ceil(d.chars / 1000)}k chars</td>
                      <td style={{ textAlign: "right" }}>
                        <form action={deleteKbDocAction}>
                          <input type="hidden" name="projectId" value={p.id} />
                          <input type="hidden" name="docId" value={d.id} />
                          <SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm={`Remove "${d.title}"?`}>Remove</SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>2. New audit</h3>
              <span className="sub">Export chats from Intercom, Tidio, Crisp, Zendesk or your own bot as CSV or JSON.</span>
            </div>
            <Badge tone={llmAvailable() ? "brand" : "muted"}>{judgeProvider() === "gemini" ? "Gemini judge" : judgeProvider() === "anthropic" ? "Claude judge" : "Basic mode"}</Badge>
          </div>
          <form action={startAuditAction}>
            <input type="hidden" name="projectId" value={p.id} />
            <div className="field">
              <label htmlFor="name">Audit name <span className="hint">(optional)</span></label>
              <input id="name" name="name" type="text" placeholder="September chats" maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="file">Transcript file <span className="hint">(.csv or .json, up to 500 conversations)</span></label>
              <input id="file" name="file" type="file" accept=".csv,.json,text/csv,application/json" />
            </div>
            <details>
              <summary>…or paste transcripts</summary>
              <textarea name="pasted" placeholder={SAMPLE_CSV} style={{ minHeight: 140 }} className="mono" />
              <p className="hint">CSV columns: <code>conversation_id, role, message</code>. Roles: customer/user and bot/assistant. JSON: <code>{`[{"id":"1","messages":[{"role":"user","content":"…"}]}]`}</code></p>
            </details>
            <div style={{ marginTop: 12 }}>
              <SubmitButton pendingText="Starting audit…">Start audit</SubmitButton>
            </div>
          </form>
          {docs.length === 0 ? <p className="hint" style={{ marginTop: 10 }}>Tip: add your help articles first. Without them ProofMyAI can&apos;t tell if an answer is made up.</p> : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Audit history</h3></div>
        {audits.length === 0 ? (
          <Empty icon="💬" title="No audits yet">Upload your first transcript export above. Results appear in about a minute.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Audit</th><th>Status</th><th>Score</th><th>Answers</th><th>Problems</th><th>Mode</th><th>When</th><th /></tr></thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/app/p/${p.id}/chatbot/audit/${a.id}`}><strong>{a.name}</strong></Link></td>
                    <td><StatusBadge status={a.status} /></td>
                    <td><ScoreBadge score={a.score} /></td>
                    <td>{a.items}</td>
                    <td>{a.problems ? <Badge tone="bad">{a.problems}</Badge> : <Badge tone="ok">0</Badge>}</td>
                    <td className="sub">{a.mode === "ai" ? "AI judge" : "Basic"}</td>
                    <td className="sub">{timeAgo(a.created_at)}</td>
                    <td>
                      <form action={deleteAuditAction}>
                        <input type="hidden" name="projectId" value={p.id} />
                        <input type="hidden" name="auditId" value={a.id} />
                        <SubmitButton className="btn btn-ghost btn-sm" pendingText="…" confirm="Delete this audit and its results?">Delete</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
