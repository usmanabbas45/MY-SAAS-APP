import Link from "next/link";
import { PublicPage } from "@/components/site";
import { SITE_URL, VIDEOS } from "@/lib/seo";

export const metadata = {
  title: "Docs & API reference",
  description: "How to connect AI chatbots, AI agents and n8n/Make workflows to ProofMyAI: setup steps, REST API reference with examples, limits and error codes.",
  alternates: { canonical: "/docs" },
};

const API = `${SITE_URL}/api/v1`;

const TOC = [
  ["quick-start", "🚀 Quick start"],
  ["no-code", "🧩 Connect without code"],
  ["auth", "🔑 Authentication"],
  ["chat-events", "💬 POST /chat-events (live chatbot)"],
  ["feedback", "👍 POST /feedback (customer ratings)"],
  ["agent-runs", "🤖 POST /agent-runs (AI agents)"],
  ["workflow-runs", "⚙️ POST /workflow-runs (n8n, Make, Zapier)"],
  ["errors", "⚠️ Errors & limits"],
  ["privacy", "🔒 Privacy & data"],
] as const;

function Code({ children }: { children: string }) {
  return <pre style={{ overflowX: "auto" }}><code>{children}</code></pre>;
}

function Fields({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>{rows.map(([f, t, d]) => <tr key={f}><td><code>{f}</code></td><td>{t}</td><td>{d}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <PublicPage title="Docs & API reference">
      <p>Everything you need to connect your AI chatbot, AI agents and n8n/Make automations to ProofMyAI. Most setups take under 10 minutes and many need no code at all. Prefer video? Watch the <a href={`https://www.youtube.com/watch?v=${VIDEOS.tutorial.id}`} target="_blank" rel="noopener">3-minute setup tutorial ↗</a>.</p>
      <nav className="card docs-toc" aria-label="On this page">
        <strong>📚 On this page</strong>
        <ol>{TOC.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol>
      </nav>

      <h2 id="quick-start">🚀 Quick start</h2>
      <ol>
        <li><Link href="/signup">Create a free account</Link> (50 conversations a month free).</li>
        <li>Open your project → <strong>Settings</strong> and copy your <strong>API key</strong> (it starts with <code>ap_live_</code>). Each project has its own key.</li>
        <li>Pick what you want to monitor: upload chat transcripts, connect n8n/Make, or send events to the API below.</li>
        <li>Add a Slack, email, Telegram or webhook channel under <strong>Settings → Notifications</strong> so you hear about problems.</li>
      </ol>

      <h2 id="no-code">🧩 Connect without code</h2>
      <ul>
        <li><strong>Chat transcripts:</strong> export conversations from Intercom, Tidio, Crisp, Zendesk or any bot as CSV/JSON and upload them in <em>Chatbot audits</em>. Add your help articles first so answers are checked against them.</li>
        <li><strong>Nightly bot tests:</strong> in <em>Chatbot tests</em>, paste your bot&apos;s HTTP endpoint and a list of questions with the facts a right answer must include. ProofMyAI asks your bot every night.</li>
        <li><strong>n8n:</strong> n8n → Settings → n8n API → create a key. In ProofMyAI open <em>n8n &amp; Make</em> → Connect n8n and paste your n8n URL and key. Executions are pulled every 15 minutes.</li>
        <li><strong>Make:</strong> Make → Profile → API access → add a token with <code>scenarios:read</code>. Connect Make in ProofMyAI with your scenario IDs.</li>
        <li><strong>WhatsApp live monitoring (WAHA):</strong> add the webhook <code>{API}/whatsapp/waha</code> to your WAHA session with the event <code>message.any</code> and header <code>X-Api-Key</code> set to your project key. Customer messages and bot replies are paired and checked; phone numbers are replaced with anonymous codes.</li>
        <li><strong>Twilio / WhatsApp:</strong> in <em>Live tracking</em>, connect Twilio with a read-only API key to check bot replies on SMS and WhatsApp.</li>
      </ul>

      <h2 id="auth">🔑 Authentication</h2>
      <p>Send your project API key with every request, in either header:</p>
      <Code>{`Authorization: Bearer ap_live_xxxxxxxxxxxxxxxx
# or
X-API-Key: ap_live_xxxxxxxxxxxxxxxx`}</Code>
      <p>Base URL: <code>{API}</code>. Bodies are JSON (<code>Content-Type: application/json</code>), up to 2 MB. Keep the key on your server; don&apos;t put it in browser code. You can regenerate it in Settings at any time.</p>

      <h2 id="chat-events">💬 POST /chat-events: live chatbot monitoring</h2>
      <p>Send each conversation as it happens, either the full message history or just the newest question and answer. Personal data is masked before anything is stored or checked. Replies are graded in the background against your help articles and rules.</p>
      <Fields rows={[
        ["conversation_id", "string, required", "Your ID for the conversation. Sending the same ID again adds only the new turns."],
        ["messages", "array", "Full history: [{ role: \"user\" | \"assistant\", content }]."],
        ["question", "string", "The customer's message. Send it alone when the customer writes, and ProofMyAI alerts you if the bot never replies."],
        ["answer", "string", "The bot's reply to question."],
        ["bot_name", "string", "Optional label when you run several bots."],
        ["latency_ms", "integer", "Optional: how long the reply took."],
        ["cost_usd", "number", "Optional: what the reply cost."],
        ["error", "string", "Optional: an error your bot hit while replying."],
      ]} />
      <p>Send <code>messages</code>, or <code>question</code> + <code>answer</code>, or just <code>question</code>.</p>
      <Code>{`curl -X POST ${API}/chat-events \\
  -H "Authorization: Bearer $PROOFMYAI_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversation_id": "chat-8841",
    "question": "How much is shipping to Germany?",
    "answer": "Shipping to Germany is free on all orders.",
    "latency_ms": 1850
  }'`}</Code>
      <p>Response <code>202</code>: <code>{`{"accepted": 1}`}</code>. Add <code>?wait=1</code> to wait for the verdicts (slower; useful for testing):</p>
      <Code>{`{"graded": 1, "results": [{"turn_index": 0, "verdict": "hallucination", "label": "Made up",
  "severity": "high", "reason": "The shipping article says Germany costs €9.90; free shipping is not mentioned."}]}`}</Code>
      <p>Verdicts: <code>correct</code>, <code>unsupported</code> (not in your docs), <code>hallucination</code> (made up), <code>should_escalate</code>, <code>off_policy</code>, <code>unclear</code>.</p>
      <p><strong>Tip:</strong> call the API without waiting for it (fire-and-forget) so your bot never slows down. The <em>Live tracking</em> page in your dashboard has ready-made cURL, JavaScript and Python snippets that do this safely, plus no-code steps for Intercom, Zendesk, Crisp and Tidio through n8n or Make.</p>

      <h2 id="feedback">👍 POST /feedback: customer ratings</h2>
      <p>Send each thumbs up/down or star rating your customers give the bot. ProofMyAI shows customer satisfaction overall and per topic on the <em>Analytics</em> page. Use the same <code>conversation_id</code> you send to <code>/chat-events</code>.</p>
      <Code>{`curl -X POST ${API}/feedback \
  -H "Authorization: Bearer ap_live_your_key" -H "Content-Type: application/json" \
  -d '{"conversation_id": "chat-8812", "rating": "down", "comment": "Wrong delivery price"}'`}</Code>
      <p><code>rating</code>: <code>"up"</code> / <code>"down"</code>, <code>true</code> / <code>false</code>, whole stars <code>1</code>–<code>5</code>, or a decimal score from <code>0</code> to <code>1</code>. Optional: <code>turn_index</code> (which reply was rated) and <code>comment</code>. Response <code>201</code>: <code>{`{"ok": true, "id": 42}`}</code>.</p>

      <h2 id="agent-runs">🤖 POST /agent-runs: AI agent monitoring</h2>
      <p>Send one request when an agent run finishes. ProofMyAI checks it for loops, tool errors, runaway cost, slow runs, empty output and answers the tools didn&apos;t support.</p>
      <Fields rows={[
        ["run_id", "string, required", "Unique ID of this run. Sending the same run_id twice returns 409."],
        ["agent_name", "string, required", "Which agent ran, e.g. \"refund-agent\"."],
        ["goal", "string", "What the agent was asked to do."],
        ["status", "string", "success (default), error, timeout or cancelled."],
        ["final_output", "string", "The agent's final answer or result."],
        ["steps", "array", "Each step: { type: llm | tool | retrieval | other, name, input, output, error, duration_ms, tokens, cost_usd }."],
      ]} />
      <Code>{`curl -X POST ${API}/agent-runs \\
  -H "Authorization: Bearer $PROOFMYAI_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "run_id": "run_2026_0412",
    "agent_name": "refund-agent",
    "goal": "Refund order #1043",
    "status": "success",
    "final_output": "Refund of $49 issued.",
    "steps": [
      {"type": "tool", "name": "lookup_order", "output": {"total": 49}, "duration_ms": 320},
      {"type": "tool", "name": "issue_refund", "error": "Payment API timeout", "duration_ms": 30000, "cost_usd": 0.002}
    ]
  }'`}</Code>
      <p>Response <code>201</code> (example):</p>
      <Code>{`{"id": 812, "score": 55, "issues": [
  {"code": "TOOL_ERRORS", "severity": "high", "message": "..."},
  {"code": "ENDED_ON_ERROR", "severity": "medium", "message": "The last step failed but the run still reported success."}]}`}</Code>
      <p>Issue codes: <code>RUN_FAILED</code>, <code>TOOL_ERRORS</code>, <code>LOOP_DETECTED</code>, <code>TOO_MANY_STEPS</code>, <code>OVER_BUDGET</code>, <code>SLOW_RUN</code>, <code>EMPTY_OUTPUT</code>, <code>ENDED_ON_ERROR</code>, plus from the AI review <code>GOAL_NOT_MET</code> and <code>UNGROUNDED_OUTPUT</code>. Set your step, cost and time limits in project Settings.</p>

      <h2 id="workflow-runs">⚙️ POST /workflow-runs: n8n, Make and Zapier</h2>
      <p>Most people connect n8n or Make with an API key instead (see above). Use this endpoint for Zapier, self-built pipelines, or to push runs yourself. Send one run or an array of up to 500.</p>
      <Fields rows={[
        ["workflow_id", "string, required", "Your workflow or scenario ID."],
        ["execution_id", "string, required", "Unique ID of this run (duplicates are ignored)."],
        ["status", "string, required", "success, error, warning, running, waiting, cancelled or crashed."],
        ["platform", "string", "n8n, make, zapier or other (default)."],
        ["workflow_name", "string", "Readable name shown in alerts."],
        ["started_at", "ISO 8601", "When the run started, with a time zone, e.g. 2026-09-29T10:15:00Z."],
        ["duration_ms", "number", "How long it took."],
        ["output_items", "integer", "How many items it produced. 0 on a \"success\" is flagged as a silent failure."],
        ["error_message", "string", "The error, if any."],
      ]} />
      <Code>{`curl -X POST ${API}/workflow-runs \\
  -H "Authorization: Bearer $PROOFMYAI_KEY" \\
  -H "Content-Type: application/json" \\
  -d '[{"platform": "zapier", "workflow_id": "order-sync", "workflow_name": "Shopify → Sheets",
        "execution_id": "ex_99121", "status": "success", "output_items": 0, "duration_ms": 2400}]'`}</Code>
      <p>Response <code>201</code>: <code>{`{"received": 1, "created": 1, "duplicates": 0}`}</code></p>

      <h2 id="errors">⚠️ Errors &amp; limits</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code>400</code></td><td>Invalid JSON or a missing/invalid field. The <code>error</code> field says which one.</td></tr>
            <tr><td><code>401</code></td><td>Missing or wrong API key, or the account is suspended.</td></tr>
            <tr><td><code>402</code></td><td>Your plan&apos;s monthly limit is reached. Upgrade under Plan &amp; billing; nothing else breaks.</td></tr>
            <tr><td><code>409</code></td><td>An agent run with this <code>run_id</code> was already recorded.</td></tr>
            <tr><td><code>413</code></td><td>Body over 2 MB, or more than 500 workflow runs in one request.</td></tr>
            <tr><td><code>429</code></td><td>More than 600 requests per minute for one project. Retry after a short pause.</td></tr>
          </tbody>
        </table>
      </div>
      <p>Errors look like <code>{`{"error": "conversation_id: Required"}`}</code>. A service health check is available at <code>{SITE_URL}/api/health</code>, and live status at <Link href="/status">/status</Link>.</p>

      <h2 id="privacy">🔒 Privacy &amp; data</h2>
      <p>Emails, phone numbers, card numbers, IBANs, IP addresses and names are masked before storage or AI checks. Per project you can turn on results-only storage, set auto-delete, add your own words to mask, or switch AI checking off. Details in the <Link href="/security">Trust Center</Link>.</p>

      <p className="sub" style={{ marginTop: 28 }}>Stuck? <Link href="/support">Open a support ticket</Link> or message us on WhatsApp. See what&apos;s new in the <Link href="/changelog">changelog</Link>.</p>
    </PublicPage>
  );
}
