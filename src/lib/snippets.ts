/** Copy-paste integration snippets shown in the dashboard and setup guide. */

export function agentSnippets(appUrl: string, key: string) {
  const url = `${appUrl}/api/v1/agent-runs`;
  return {
    url,
    curl: `curl -X POST ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "run_id": "run-123",
    "agent_name": "Lead researcher",
    "goal": "Find the CEO email for acme.com",
    "status": "success",
    "final_output": "The CEO is Jane Doe (jane@acme.com)",
    "steps": [
      {"type": "tool", "name": "web_search", "input": {"q": "acme ceo"}, "output": "Jane Doe is CEO", "duration_ms": 900, "cost_usd": 0.001},
      {"type": "llm", "name": "summarise", "tokens": 812, "cost_usd": 0.004, "duration_ms": 1400}
    ]
  }'`,
    js: `// After your agent finishes (Node 18+, any framework: LangChain, OpenAI Agents, Claude, CrewAI...)
// Fire-and-forget with a 2-second limit: monitoring can never slow down or break your agent.
fetch("${url}", {
  method: "POST",
  headers: { Authorization: "Bearer ${key}", "Content-Type": "application/json" },
  body: JSON.stringify({ run_id, agent_name: "Lead researcher", goal, status: "success", final_output, steps }),
  signal: AbortSignal.timeout(2000),
}).catch(() => {}); // no await: never blocks, never throws`,
    python: `import threading, requests

def report_run(payload):
    try:
        requests.post("${url}",
                      headers={"Authorization": "Bearer ${key}"},
                      json=payload, timeout=2)
    except Exception:
        pass  # monitoring must never break your agent

# Fire-and-forget in the background:
threading.Thread(target=report_run, daemon=True, args=({
    "run_id": run_id, "agent_name": "Lead researcher", "goal": goal,
    "status": "success", "final_output": final_output, "steps": steps},)).start()`,
  };
}

export function workflowSnippets(appUrl: string, key: string) {
  const url = `${appUrl}/api/v1/workflow-runs`;
  return {
    n8nBody: `{
  "platform": "n8n",
  "workflow_id": "{{ $json.workflow.id }}",
  "workflow_name": "{{ $json.workflow.name }}",
  "execution_id": "{{ $json.execution.id }}",
  "status": "error",
  "error_message": "{{ $json.execution.error.message }}"
}`,
    makeBody: `{
  "platform": "make",
  "workflow_id": "{{var.scenario.id}}",
  "workflow_name": "{{var.scenario.name}}",
  "execution_id": "{{var.execution.id}}",
  "status": "success",
  "output_items": 1
}`,
    curl: `curl -X POST ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"platform":"other","workflow_id":"daily-sync","execution_id":"2026-09-27-01","status":"success","output_items":42,"duration_ms":5300}'`,
    url,
  };
}

export function liveChatSnippets(appUrl: string, key: string) {
  const url = `${appUrl}/api/v1/chat-events`;
  return {
    url,
    curl: `curl -X POST ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"conversation_id": "chat-8812", "question": "How much is express shipping?", "answer": "Express shipping costs $15."}'`,
    js: `// Call after your bot has replied. Fire-and-forget with a 2-second limit:
// ProofMyAI answers instantly and grades in the background, and your bot never waits or fails because of it.
fetch("${url}", {
  method: "POST",
  headers: { Authorization: "Bearer ${key}", "Content-Type": "application/json" },
  body: JSON.stringify({ conversation_id: chatId, messages }), // messages: [{ role: "user" | "assistant", content }]
  signal: AbortSignal.timeout(2000),
}).catch(() => {}); // no await: never blocks, never throws`,
    python: `import threading, requests

def report_chat(chat_id, messages):
    try:
        requests.post("${url}",
                      headers={"Authorization": "Bearer ${key}"},
                      json={"conversation_id": chat_id, "messages": messages},  # [{"role": "user"|"assistant", "content": ...}]
                      timeout=2)
    except Exception:
        pass  # monitoring must never break your bot

# After your bot has replied (e.g. at the end of your webhook handler), in the background:
threading.Thread(target=report_chat, args=(chat_id, messages), daemon=True).start()`,
  };
}

/** Grok (xAI) bots: call xAI as usual, then report the conversation to ProofMyAI without waiting. */
export function grokSnippets(appUrl: string, key: string) {
  const url = `${appUrl}/api/v1/chat-events`;
  return {
    js: `// xAI's API is OpenAI-compatible: npm install openai
import OpenAI from "openai";

const grok = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });

export async function reply(chatId, messages) {
  const res = await grok.chat.completions.create({ model: process.env.XAI_MODEL, messages }); // the Grok model you use
  const answer = res.choices[0].message.content;

  // Report to ProofMyAI: fire-and-forget, 2-second limit, never blocks or breaks your bot.
  fetch("${url}", {
    method: "POST",
    headers: { Authorization: "Bearer ${key}", "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: chatId, messages: [...messages.filter((m) => m.role !== "system"), { role: "assistant", content: answer }] }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});

  return answer;
}`,
    python: `# xAI's API is OpenAI-compatible: pip install openai requests
import os, threading, requests
from openai import OpenAI

grok = OpenAI(api_key=os.environ["XAI_API_KEY"], base_url="https://api.x.ai/v1")

def report_chat(chat_id, messages):
    try:
        requests.post("${url}",
                      headers={"Authorization": "Bearer ${key}"},
                      json={"conversation_id": chat_id, "messages": messages},
                      timeout=2)
    except Exception:
        pass  # monitoring must never break your bot

def reply(chat_id, messages):
    res = grok.chat.completions.create(model=os.environ["XAI_MODEL"], messages=messages)  # the Grok model you use
    answer = res.choices[0].message.content
    convo = [m for m in messages if m["role"] != "system"] + [{"role": "assistant", "content": answer}]
    threading.Thread(target=report_chat, args=(chat_id, convo), daemon=True).start()
    return answer`,
    /** Body for "Test my bot every night" when the bot is a system prompt on xAI's API. */
    testBody: `{"model": "YOUR_GROK_MODEL", "messages": [{"role": "system", "content": "YOUR BOT'S SYSTEM PROMPT"}, {"role": "user", "content": "{{question}}"}]}`,
  };
}
