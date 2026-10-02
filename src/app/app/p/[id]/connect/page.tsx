import Link from "next/link";
import { AutoRefresh, CopyButton, SubmitButton } from "@/components/client";
import { Flash, PageHeader, timeAgo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { sourceStatuses, type Source } from "@/lib/live";
import { ownedProject } from "@/lib/projects";
import { agentSnippets, liveChatSnippets, workflowSnippets } from "@/lib/snippets";
import { addChatSourceAction, addTargetAction, addWorkflowSourceAction, sendTestEventAction } from "../actions";

export const metadata = { title: "Connect" };

type Group = Source;
interface Method { id: string; group: Group; icon: string; title: string; text: string; time: string; code?: boolean }

const METHODS: Method[] = [
  { id: "upload", group: "chatbot", icon: "📤", title: "Upload chat history", text: "Export chats from Intercom, Zendesk, Tidio, Crisp or any bot and upload the file.", time: "3 min · no code" },
  { id: "nocode-chat", group: "chatbot", icon: "🔗", title: "Intercom, Zendesk, Crisp, Tidio, Chatbase", text: "Live checking of every answer using one HTTP step in n8n, Make or Zapier.", time: "5 min · no code" },
  { id: "whatsapp", group: "chatbot", icon: "📱", title: "WhatsApp bot (WAHA)", text: "Paste one webhook URL in WAHA. Every message is checked live.", time: "2 min · no code" },
  { id: "twilio", group: "chatbot", icon: "☎️", title: "WhatsApp or SMS via Twilio", text: "Read-only: we read your Twilio message log every 15 minutes.", time: "3 min · no code" },
  { id: "website", group: "chatbot", icon: "💻", title: "My own chatbot (code)", text: "Custom GPT backend, website widget or any bot you built. One HTTP call.", time: "5 min · developer", code: true },
  { id: "endpoint", group: "chatbot", icon: "🧪", title: "Test my bot every night", text: "We ask your bot real questions daily and alert you when answers get worse.", time: "5 min · needs a bot URL" },
  { id: "agent", group: "agents", icon: "🤖", title: "AI agent in code", text: "LangChain, OpenAI Agents, Claude, CrewAI or your own. Send each run when it finishes.", time: "5 min · developer", code: true },
  { id: "agent-nocode", group: "agents", icon: "🧩", title: "AI agent in n8n or Make", text: "Add one HTTP Request step at the end of your agent workflow.", time: "3 min · no code" },
  { id: "n8n", group: "workflows", icon: "🟠", title: "n8n", text: "Paste your n8n URL and API key. We check every workflow every 15 minutes.", time: "2 min · no code" },
  { id: "make", group: "workflows", icon: "🟣", title: "Make", text: "Paste a Make API token and your scenario IDs.", time: "2 min · no code" },
  { id: "webhook", group: "workflows", icon: "⚡", title: "Zapier or anything else", text: "Send a webhook when a workflow runs or fails.", time: "3 min" },
];

const GROUPS: { id: Group; icon: string; title: string; sub: string }[] = [
  { id: "chatbot", icon: "💬", title: "Chatbots", sub: "Check every answer your bot gives customers" },
  { id: "agents", icon: "🤖", title: "AI agents", sub: "Catch loops, tool errors, high costs and bad results" },
  { id: "workflows", icon: "⚙️", title: "Workflows", sub: "Get alerted when automations fail or go quiet" },
];

function Step({ n, title, children }: { n: number; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="cx-step">
      <span className="cx-num" aria-hidden>{n}</span>
      <div style={{ minWidth: 0, flex: 1 }}><div className="cx-step-title">{title}</div>{children}</div>
    </li>
  );
}

function CopyField({ label, value, display }: { label: string; value: string; display?: string }) {
  return (
    <div className="cx-copy">
      <span className="cx-copy-label">{label}</span>
      <code>{display ?? value}</code>
      <CopyButton text={value} />
    </div>
  );
}

function Code({ blocks }: { blocks: [string, string][] }) {
  const block = ([name, code]: [string, string]) => (
    <>
      <div className="row between cx-code-head"><strong>{name}</strong><CopyButton text={code} /></div>
      <pre>{code}</pre>
    </>
  );
  return (
    <div className="cx-code">
      {block(blocks[0])}
      {blocks.slice(1).map((b) => (
        <details key={b[0]}><summary className="sub">Show {b[0]}</summary>{block(b)}</details>
      ))}
    </div>
  );
}

export default async function ConnectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ with?: string; ok?: string; error?: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const sp = await searchParams;
  const base = `/app/p/${p.id}`;
  const method = METHODS.find((m) => m.id === sp.with);
  const back = method ? `${base}/connect?with=${method.id}` : `${base}/connect`;
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const chat = liveChatSnippets(appUrl, p.api_key);
  const agent = agentSnippets(appUrl, p.api_key);
  const flow = workflowSnippets(appUrl, p.api_key);
  const waUrl = chat.url.replace(/\/chat-events$/, "/whatsapp/waha");
  const pid = <><input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="back" value={back} /></>;
  const n = (sql: string) => get<{ n: number }>(sql, p.id)?.n ?? 0;

  // What is already connected, per group.
  const statuses = Object.fromEntries(sourceStatuses(p.id).map((s) => [s.source, s])) as Record<Group, ReturnType<typeof sourceStatuses>[number]>;
  const counts = {
    chatbot: n("SELECT COUNT(*) AS n FROM chat_sources WHERE project_id = ?") + n("SELECT COUNT(*) AS n FROM bot_targets WHERE project_id = ?") + n("SELECT COUNT(*) AS n FROM audits WHERE project_id = ? AND status <> 'live'"),
    agents: 0,
    workflows: n("SELECT COUNT(*) AS n FROM workflow_sources WHERE project_id = ?"),
  };
  const connected = (g: Group) => statuses[g].lastAt != null || counts[g] > 0;
  const lastSeen = (g: Group) => statuses[g].lastAt;
  const waiting = method && !connected(method.group);

  const header = (
    <PageHeader
      title={method ? `${method.icon} Connect: ${method.title}` : "Connect your AI"}
      subtitle={method ? method.text : "Pick what you use. Each option takes 2 to 5 minutes and shows ✅ the moment your first data arrives."}
      actions={method ? <Link href={`${base}/connect`} className="btn btn-ghost btn-sm">← All options</Link> : undefined}
    />
  );

  if (!method) {
    return (
      <div>
        <Flash ok={sp.ok} error={sp.error} />
        {header}
        <div className="cx-status">
          {GROUPS.map((g) => (
            <div key={g.id} className={`cx-status-item ${connected(g.id) ? "on" : ""}`}>
              <span className="cx-dot" aria-hidden />
              <span><strong>{g.icon} {g.title}</strong><small>{connected(g.id) ? (lastSeen(g.id) ? `Connected · last data ${timeAgo(new Date(lastSeen(g.id)!).toISOString())}` : "Connected") : "Not connected yet"}</small></span>
            </div>
          ))}
        </div>
        {GROUPS.map((g) => (
          <section key={g.id} className="cx-group" id={g.id}>
            <h2>{g.icon} {g.title} <span className="sub">{g.sub}</span></h2>
            <div className="cx-grid">
              {METHODS.filter((m) => m.group === g.id).map((m) => (
                <Link key={m.id} href={`${base}/connect?with=${m.id}`} className="cx-card">
                  <span className="cx-card-icon" aria-hidden>{m.icon}</span>
                  <strong>{m.title}</strong>
                  <span className="sub">{m.text}</span>
                  <span className={`cx-time ${m.code ? "dev" : ""}`}>⏱ {m.time}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
        <div className="card cx-help">
          <div>
            <strong>🙋 Not sure which to pick, or stuck?</strong>
            <p className="sub" style={{ margin: "4px 0 0" }}>Tell us what you use and we&apos;ll reply with the exact steps, or set it up with you.</p>
          </div>
          <div className="row">
            <Link href={`${base}/guide`} className="btn btn-ghost btn-sm">📘 Setup guide</Link>
            <Link href="/app/support" className="btn btn-sm">Ask for help</Link>
          </div>
        </div>
      </div>
    );
  }

  const status = (
    <div className={`cx-live ${waiting ? "" : "ok"}`} role="status" aria-live="polite">
      <AutoRefresh active={Boolean(waiting)} ms={5000} />
      {waiting ? (
        <>
          <span className="cx-spinner" aria-hidden />
          <div>
            <strong>Waiting for your first data…</strong>
            <div className="sub">This box turns green by itself as soon as ProofMyAI receives something. Keep this page open while you follow the steps.</div>
          </div>
        </>
      ) : (
        <>
          <span className="cx-tick" aria-hidden>✓</span>
          <div>
            <strong>Connected!</strong>
            <div className="sub">
              {lastSeen(method.group) ? `Last data received ${timeAgo(new Date(lastSeen(method.group)!).toISOString())}. ` : ""}
              <Link href={method.group === "chatbot" ? `${base}/live` : method.group === "agents" ? `${base}/agents` : `${base}/workflows`}>See your results →</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );

  const authHeader = <CopyField label="Header" value={`Bearer ${p.api_key}`} display={`Authorization: Bearer ${p.api_key.slice(0, 12)}…`} />;
  let steps: React.ReactNode;
  switch (method.id) {
    case "upload":
      steps = (
        <ol className="cx-steps">
          <Step n={1} title="Export your chats">
            <ul className="sub">
              <li><strong>Intercom:</strong> Settings → Data → Export → Conversations</li>
              <li><strong>Zendesk:</strong> Admin → Account → Tools → Reports → Export</li>
              <li><strong>Tidio / Crisp / others:</strong> look for “Export conversations” (CSV or JSON). Any file with questions and answers works.</li>
            </ul>
          </Step>
          <Step n={2} title="Add your help articles (optional, recommended)"><p className="sub">So answers can be checked against your real information: paste your FAQ or help pages.</p></Step>
          <Step n={3} title="Upload the file">
            <Link href={`${base}/chatbot#new-audit`} className="btn">Open the upload form →</Link>
          </Step>
        </ol>
      );
      break;
    case "nocode-chat":
      steps = (
        <ol className="cx-steps">
          <Step n={1} title={<>In n8n, Make or Zapier, start a workflow from your chat tool&apos;s <em>“new reply / message created”</em> trigger</>} />
          <Step n={2} title={<>Add an <strong>HTTP Request</strong> step (Make: HTTP → Make a request · Zapier: Webhooks → POST)</>}>
            <CopyField label="Method + URL" value={chat.url} display={`POST ${chat.url}`} />
            {authHeader}
          </Step>
          <Step n={3} title="Body (JSON): map the three fields from your trigger">
            <Code blocks={[["JSON body", `{\n  "conversation_id": "<conversation id>",\n  "question": "<customer message>",\n  "answer": "<bot reply>"\n}`]]} />
            <p className="hint">Tip: set the step to <strong>continue on error</strong> so monitoring can never break your workflow.</p>
          </Step>
        </ol>
      );
      break;
    case "whatsapp":
      steps = (
        <ol className="cx-steps">
          <Step n={1} title={<>Open WAHA → <strong>Sessions</strong> → your bot&apos;s session → <strong>Webhooks</strong> → <strong>Add webhook</strong></>}>
            <p className="sub">This adds a second webhook. Your bot&apos;s own webhook keeps working.</p>
          </Step>
          <Step n={2} title="Paste this URL and tick the event message.any">
            <CopyField label="URL" value={waUrl} />
          </Step>
          <Step n={3} title={<>Add a custom header named <code>X-Api-Key</code> with this value</>}>
            <CopyField label="X-Api-Key" value={p.api_key} display={`${p.api_key.slice(0, 12)}…`} />
            <p className="hint">No custom headers in your WAHA version? Use this URL instead: <CopyButton text={`${waUrl}?key=${p.api_key}`} label="Copy URL with key" /></p>
          </Step>
          <Step n={4} title="Save, then send your bot a WhatsApp message" />
        </ol>
      );
      break;
    case "twilio":
      steps = (
        <form action={addChatSourceAction}>
          {pid}
          <ol className="cx-steps">
            <Step n={1} title={<>Twilio Console → <strong>Account info</strong> → copy the <strong>Account SID</strong></>}>
              <div className="field"><label htmlFor="tw-ac">Account SID</label><input id="tw-ac" name="account_sid" type="text" placeholder="AC…" required autoComplete="off" /></div>
            </Step>
            <Step n={2} title={<>Console → <strong>API keys &amp; tokens</strong> → <strong>Create API key</strong> (or use your Auth token)</>}>
              <div className="grid grid-2">
                <div className="field"><label htmlFor="tw-sk">API key SID <span className="hint">(optional)</span></label><input id="tw-sk" name="key_sid" type="text" placeholder="SK…" autoComplete="off" /></div>
                <div className="field"><label htmlFor="tw-secret">API key secret or Auth token</label><input id="tw-secret" name="secret" type="password" required autoComplete="off" /></div>
              </div>
            </Step>
            <Step n={3} title="Your bot's number, exactly as in Twilio">
              <div className="grid grid-2">
                <div className="field"><label htmlFor="tw-num">Bot number</label><input id="tw-num" name="bot_number" type="text" placeholder="whatsapp:+14155238886" required /></div>
                <div className="field"><label htmlFor="tw-name">Name <span className="hint">(optional)</span></label><input id="tw-name" name="name" type="text" placeholder="WhatsApp bot" maxLength={100} /></div>
              </div>
              <SubmitButton pendingText="Connecting…">Connect Twilio</SubmitButton>
              <p className="hint" style={{ marginTop: 8 }}>Read-only and stored encrypted. ProofMyAI never sends messages.</p>
            </Step>
          </ol>
        </form>
      );
      break;
    case "website":
      steps = (
        <ol className="cx-steps">
          <Step n={1} title="After your bot replies, send the conversation to ProofMyAI">
            <Code blocks={[["JavaScript / TypeScript", chat.js], ["Python", chat.python], ["cURL (try it now)", chat.curl]]} />
            <p className="hint">Your API key is already filled in. Calls are fire-and-forget with a 2-second limit, so your bot never waits or breaks.</p>
          </Step>
          <Step n={2} title="Optional: catch messages your bot never answers">
            <p className="sub">Also send each customer message as it arrives with just <code>{`{"conversation_id": "...", "question": "..."}`}</code>. No reply within {p.reply_timeout_sec || 120} seconds = alert.</p>
          </Step>
          <Step n={3} title="Not ready to code yet? Send a test event to see how results look">
            <form action={sendTestEventAction}>{pid}<SubmitButton className="btn btn-ghost" pendingText="Sending…">▶ Send test event</SubmitButton></form>
          </Step>
        </ol>
      );
      break;
    case "endpoint":
      steps = (
        <form action={addTargetAction}>
          {pid}
          <p className="alert alert-warn">Use a <strong>test or staging</strong> URL that returns the bot&apos;s answer, never a live WhatsApp/SMS/Messenger webhook (tests send real questions).</p>
          <ol className="cx-steps">
            <Step n={1} title="Your bot's URL">
              <div className="grid grid-2">
                <div className="field"><label htmlFor="tname">Name</label><input id="tname" name="name" type="text" placeholder="Website support bot" /></div>
                <div className="field"><label htmlFor="url">Endpoint URL (POST)</label><input id="url" name="url" type="url" required placeholder="https://api.yourbot.com/chat" /></div>
              </div>
            </Step>
            <Step n={2} title={<>What to send: put <code>{"{{question}}"}</code> where the question goes</>}>
              <div className="field"><textarea id="body" name="body_template" className="mono" aria-label="Request body" defaultValue={'{"message": "{{question}}"}'} style={{ minHeight: 60 }} /></div>
              <details><summary className="sub">Advanced: answer location and headers</summary>
                <div className="field"><label htmlFor="rpath">Answer location in the response <span className="hint">(e.g. <code>reply</code>; empty = whole response)</span></label><input id="rpath" name="response_path" type="text" placeholder="reply" /></div>
                <div className="field"><label htmlFor="headers">Headers <span className="hint">(JSON, stored encrypted)</span></label><textarea id="headers" name="headers" className="mono" placeholder={'{"Authorization": "Bearer your-bot-key"}'} style={{ minHeight: 50 }} /></div>
              </details>
            </Step>
            <Step n={3} title="Save, then add a few real customer questions">
              <SubmitButton pendingText="Saving…">Save bot</SubmitButton>
            </Step>
          </ol>
        </form>
      );
      break;
    case "agent":
      steps = (
        <ol className="cx-steps">
          <Step n={1} title="When your agent finishes, send the run">
            <Code blocks={[["JavaScript / TypeScript", agent.js], ["Python", agent.python], ["cURL (try it now)", agent.curl]]} />
            <p className="hint">Only <code>run_id</code> and <code>agent_name</code> are required. Add <code>goal</code> and <code>steps</code> for the full AI review.</p>
          </Step>
          <Step n={2} title="Run your agent once" />
        </ol>
      );
      break;
    case "agent-nocode":
      steps = (
        <ol className="cx-steps">
          <Step n={1} title={<>At the end of your agent workflow, add an <strong>HTTP Request</strong> step</>}>
            <CopyField label="Method + URL" value={agent.url} display={`POST ${agent.url}`} />
            {authHeader}
          </Step>
          <Step n={2} title="Body (JSON): map the agent's goal and final answer">
            <Code blocks={[["n8n body", `{\n  "run_id": "{{ $execution.id }}",\n  "agent_name": "{{ $workflow.name }}",\n  "goal": "{{ $('When chat message received').item.json.chatInput }}",\n  "status": "success",\n  "final_output": "{{ $json.output }}"\n}`], ["Make body", `{\n  "run_id": "{{var.execution.id}}",\n  "agent_name": "{{var.scenario.name}}",\n  "goal": "<the task you gave the agent>",\n  "status": "success",\n  "final_output": "<the agent's answer>"\n}`]]} />
          </Step>
          <Step n={3} title="Run the workflow once" />
        </ol>
      );
      break;
    case "n8n":
      steps = (
        <form action={addWorkflowSourceAction}>
          {pid}<input type="hidden" name="platform" value="n8n" />
          <ol className="cx-steps">
            <Step n={1} title="Your n8n address (copy it from your browser when n8n is open)">
              <div className="field"><input id="n8n-url" name="base_url" type="url" required placeholder="https://yourname.app.n8n.cloud" aria-label="n8n URL" /></div>
            </Step>
            <Step n={2} title={<>In n8n: <strong>Settings</strong> → <strong>n8n API</strong> → <strong>Create an API key</strong> → copy it</>}>
              <div className="field"><input id="n8n-key" name="api_key" type="password" required aria-label="n8n API key" placeholder="Paste the API key" autoComplete="off" /></div>
            </Step>
            <Step n={3} title="Connect">
              <div className="field"><label htmlFor="n8n-int">Alert me if no runs for… <span className="hint">(minutes, optional)</span></label><input id="n8n-int" name="expected_interval_min" type="number" min={1} placeholder="60" style={{ maxWidth: 160 }} /></div>
              <SubmitButton pendingText="Connecting…">Connect n8n</SubmitButton>
            </Step>
          </ol>
        </form>
      );
      break;
    case "make":
      steps = (
        <form action={addWorkflowSourceAction}>
          {pid}<input type="hidden" name="platform" value="make" />
          <ol className="cx-steps">
            <Step n={1} title="Which Make address do you use? (look at your browser when Make is open)">
              <div className="field">
                <select id="make-zone" name="base_url" defaultValue="https://eu1.make.com" aria-label="Make zone" style={{ maxWidth: 220 }}>
                  {["eu1", "eu2", "us1", "us2"].map((z) => <option key={z} value={`https://${z}.make.com`}>{z}.make.com</option>)}
                </select>
              </div>
            </Step>
            <Step n={2} title={<>In Make: your profile → <strong>API access</strong> → <strong>Add token</strong> → tick <code>scenarios:read</code> → copy</>}>
              <div className="field"><input id="make-key" name="api_key" type="password" required aria-label="Make API token" placeholder="Paste the token" autoComplete="off" /></div>
            </Step>
            <Step n={3} title="Scenario IDs: open each scenario, copy the number at the end of the address">
              <div className="field"><input id="make-ids" name="scenario_ids" type="text" required placeholder="1234567, 2345678" aria-label="Scenario IDs" /></div>
              <SubmitButton pendingText="Connecting…">Connect Make</SubmitButton>
            </Step>
          </ol>
        </form>
      );
      break;
    default: // webhook
      steps = (
        <ol className="cx-steps">
          <Step n={1} title="Add a webhook / HTTP POST step at the end of your workflow (and in its error path)">
            <CopyField label="Method + URL" value={flow.url} display={`POST ${flow.url}`} />
            {authHeader}
          </Step>
          <Step n={2} title="Body (JSON)">
            <Code blocks={[["JSON body", `{\n  "platform": "other",\n  "workflow_id": "daily-sync",\n  "workflow_name": "Daily order sync",\n  "execution_id": "<unique run id>",\n  "status": "success",\n  "output_items": 42\n}`], ["cURL (try it now)", flow.curl]]} />
            <p className="hint">Use <code>&quot;status&quot;: &quot;error&quot;</code> with <code>error_message</code> when it fails. <code>output_items: 0</code> on success is flagged as a silent failure.</p>
          </Step>
          <Step n={3} title="Run the workflow once" />
        </ol>
      );
  }

  return (
    <div>
      <Flash ok={sp.ok} error={sp.error} />
      {header}
      <div className="cx-layout">
        <div className="card">{steps}</div>
        <aside className="cx-side">
          {status}
          <div className="card">
            <strong>🔑 Your project API key</strong>
            <p className="sub" style={{ margin: "4px 0 8px" }}>Already filled into the steps. Keep it private.</p>
            <CopyField label="Key" value={p.api_key} display={`${p.api_key.slice(0, 14)}…`} />
          </div>
          <div className="card">
            <strong>🙋 Stuck?</strong>
            <p className="sub" style={{ margin: "4px 0 8px" }}>Send us a message and we&apos;ll help you connect it.</p>
            <Link href="/app/support" className="btn btn-ghost btn-sm">Ask for help</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
