import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ownedProject } from "@/lib/projects";

export const metadata = { title: "Setup guide" };

export default async function GuidePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const p = ownedProject(user.id, Number((await params).id));
  const b = `/app/p/${p.id}`;
  const steps: { title: string; time: string; body: React.ReactNode }[] = [
    {
      title: "Add your help articles", time: "2 min",
      body: (
        <ol>
          <li>Open <Link href={`${b}/chatbot`}>Chatbot audits</Link>.</li>
          <li>Under <strong>1. Knowledge base</strong>, click <strong>Choose files</strong> and select your FAQ/policy files (.txt or .md). Or open <em>“…or paste an article”</em> and paste one.</li>
          <li>Click <strong>Add to knowledge base</strong>.</li>
        </ol>
      ),
    },
    {
      title: "Audit your chatbot conversations", time: "3 min",
      body: (
        <ol>
          <li>Export chats from your bot platform: <strong>Intercom</strong> (Reports → Export conversations), <strong>Tidio</strong> (Conversations → Export), <strong>Crisp</strong> (Inbox → Export), <strong>Zendesk</strong> (Admin → Reports → Export), or your own database as CSV with columns <code>conversation_id, role, message</code>.</li>
          <li>In <strong>2. New audit</strong>, choose the file and click <strong>Start audit</strong>.</li>
          <li>Read the <strong>Fix list</strong> first. It tells you which article to update.</li>
          <li>Click 👍 or pick the right verdict on a few answers to teach the AI.</li>
        </ol>
      ),
    },
    {
      title: "Set up nightly chatbot tests", time: "5 min",
      body: (
        <ol>
          <li>Open <Link href={`${b}/tests`}>Chatbot tests</Link> → <strong>Add a bot endpoint</strong>.</li>
          <li>Paste your bot&apos;s API URL. Set the body, e.g. <code>{`{"message": "{{question}}"}`}</code>, and where the reply is, e.g. <code>reply</code>.</li>
          <li>Add 10–20 important questions with the facts a right answer must include.</li>
          <li>Click <strong>▶ Run tests</strong>. After that it runs automatically every 24 hours.</li>
        </ol>
      ),
    },
    {
      title: "Monitor your AI agents", time: "5 min",
      body: (
        <ol>
          <li>Open <Link href={`${b}/agents`}>AI agents</Link> and copy the code for your language.</li>
          <li>Paste it where your agent finishes. Send the <code>goal</code>, <code>final_output</code> and the <code>steps</code> (tool calls with errors and costs).</li>
          <li>Set your cost/step/time limits in <Link href={`${b}/settings`}>Settings</Link>.</li>
        </ol>
      ),
    },
    {
      title: "Connect n8n or Make", time: "2 min",
      body: (
        <ul>
          <li><strong>n8n:</strong> in n8n go to Settings → n8n API → Create an API key. In ProofMyAI open <Link href={`${b}/workflows`}>n8n &amp; Make</Link> → Connect n8n, paste your n8n URL and key.</li>
          <li><strong>Make:</strong> in Make open your avatar → Profile → API access → Add token (scope <code>scenarios:read</code>). Copy your scenario IDs from the scenario URLs, then choose Connect Make.</li>
          <li>Optional: set <em>“Alert if no runs for… minutes”</em> to catch workflows that silently stop.</li>
        </ul>
      ),
    },
    {
      title: "Turn on alerts", time: "2 min",
      body: (
        <ol>
          <li>Slack: create an Incoming Webhook (api.slack.com/messaging/webhooks). Discord: Channel settings → Integrations → Webhooks → New webhook → Copy URL.</li>
          <li>Paste it in <Link href={`${b}/settings`}>Settings</Link> → Alert webhook → <strong>Save</strong>.</li>
          <li>Click <strong>Send test alert</strong> to check it works.</li>
        </ol>
      ),
    },
    {
      title: "Train your own neural model", time: "10 min",
      body: (
        <ol>
          <li>Review at least 20 answers in any audit (👍 or a correction). Include some good and some bad ones.</li>
          <li>Go to <Link href={`${b}/settings`}>Settings</Link> → <strong>Train model</strong>.</li>
          <li>Audits now rank answers by <em>your</em> definition of risk. Retrain whenever you have reviewed more answers.</li>
        </ol>
      ),
    },
  ];
  return (
    <div>
      <PageHeader title="Setup guide" subtitle="Click-by-click. Everything takes about 30 minutes in total." />
      <div className="stack">
        {steps.map((s, i) => (
          <div key={s.title} className="card guide-step">
            <div className="guide-num">{i + 1}</div>
            <div>
              <div className="row between"><h3>{s.title}</h3><span className="badge">{s.time}</span></div>
              {s.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
