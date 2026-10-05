/**
 * "ProofMyAI vs …" comparison pages. Kept factual and fair: competitors are described from their own
 * public positioning (checked October 2026), and each page says who the other tool is better for.
 */

export interface Comparison {
  slug: string;
  name: string;
  title: string;
  description: string;
  summary: string;
  rows: [feature: string, us: string, them: string][];
  chooseUs: string[];
  chooseThem: string[];
  faqs: { q: string; a: string }[];
}

export const COMPARE_REVIEWED = "October 2026";

export const COMPARISONS: Comparison[] = [
  {
    slug: "langfuse-alternative",
    name: "Langfuse",
    title: "ProofMyAI vs Langfuse: a no-code Langfuse alternative for chatbot monitoring",
    description: "Langfuse is an open-source LLM engineering platform for developers. ProofMyAI is no-code chatbot, agent and n8n/Make monitoring for businesses and agencies. Compare features, setup and who each is for.",
    summary: "Langfuse is an excellent open-source platform for engineering teams who instrument their own LLM code with tracing, prompt management and evaluations. ProofMyAI is built for the people who run a support chatbot or automations and don't want to write code: it checks every customer answer against your help docs, tells you what to fix, and also watches n8n/Make workflows.",
    rows: [
      ["Built for", "Business owners, support teams and agencies", "Developers and AI engineering teams"],
      ["Setup", "No code: upload chat exports, paste an Intercom token, add a WhatsApp webhook or n8n/Make key", "Add the SDK or OpenTelemetry instrumentation to your application code"],
      ["Checks chatbot answers against your help docs", "Built in and automatic for every answer", "Possible by setting up your own LLM-as-a-judge evaluators"],
      ["Tells you what to fix", "Fix list per help article, plus ✨ corrected article and safer system prompt", "Not a focus: you analyse traces and scores"],
      ["n8n & Make workflow monitoring", "Yes: failures, silent failures, stopped workflows", "Not a focus"],
      ["Tracing, prompt management, experiments", "Basic AI agent run checks", "Yes, extensive"],
      ["Open source / self-hosting", "Self-hosted option for regulated businesses", "Open source (MIT) and self-hostable"],
      ["Alerts", "Slack, Teams, Discord, Telegram, Google Chat, WhatsApp, email, webhooks", "Configurable via the platform"],
      ["Pricing", "Free plan; paid from $29/month", "Free tier and free self-hosting; paid cloud plans"],
    ],
    chooseUs: ["You run a support chatbot (Intercom Fin, Tidio, Zendesk, WhatsApp…) and want every answer checked without code", "You want a plain-English fix list, not traces", "You also run n8n or Make automations", "You're an agency reporting to clients"],
    chooseThem: ["You're a developer building your own LLM app and want deep tracing", "You need prompt management and experiments in your engineering workflow", "You want a fully open-source stack"],
    faqs: [
      { q: "Is ProofMyAI a Langfuse alternative?", a: "For businesses that want to monitor a customer-facing chatbot without code, yes. For engineering teams that need tracing, prompt management and experiments inside their own code, Langfuse is the better fit. Some teams use both." },
      { q: "Do I need to write code to use ProofMyAI?", a: "No. Chatbot audits need a file upload or a no-code connection. Developers can optionally use the API for live tracking." },
    ],
  },
  {
    slug: "langsmith-alternative",
    name: "LangSmith",
    title: "ProofMyAI vs LangSmith: a no-code LangSmith alternative for businesses",
    description: "LangSmith is LangChain's developer platform for tracing, testing and evaluating LLM apps. ProofMyAI is no-code monitoring for support chatbots, AI agents and n8n/Make workflows. See the differences.",
    summary: "LangSmith, from the LangChain team, helps developers debug, test and evaluate LLM applications and agents. ProofMyAI is for businesses and agencies who run chatbots and automations: connect without code, get every customer answer checked against your own docs, and receive a fix list and alerts.",
    rows: [
      ["Built for", "Business owners, support teams and agencies", "Developers building LLM apps and agents"],
      ["Setup", "No code for chatbots and workflows; one HTTP call for agents", "SDK / tracing integration in your code"],
      ["Checks chatbot answers against your help docs", "Built in and automatic", "Possible with custom evaluators and datasets"],
      ["Tells you what to fix", "Fix list per article, ✨ corrected articles and safer prompts", "Not a focus: you inspect traces and evaluation results"],
      ["n8n & Make workflow monitoring", "Yes", "Not a focus"],
      ["Debugging, datasets, prompt hub", "Basic", "Yes, extensive"],
      ["Client reports for agencies", "White-label share links and PDFs", "Not a focus"],
      ["Pricing", "Free plan; paid from $29/month", "Free developer tier; paid plans (see their site)"],
    ],
    chooseUs: ["You want to know which customer answers are wrong, without code", "You run Intercom, Tidio, Zendesk, WhatsApp or a custom bot", "You also need n8n/Make monitoring", "You report to clients"],
    chooseThem: ["You build with LangChain or LangGraph and debug in code", "You need datasets, evaluations and prompt management for engineering", "Your team is mainly developers"],
    faqs: [
      { q: "Is ProofMyAI a LangSmith alternative?", a: "For non-developers monitoring a customer-facing chatbot or automations, yes. Developers who need deep tracing and evaluation tooling for LangChain apps will prefer LangSmith." },
      { q: "Can I use ProofMyAI with a LangChain agent?", a: "Yes. Send each agent run to ProofMyAI with one HTTP call and it checks for loops, tool errors, runaway costs and unsupported answers." },
    ],
  },
];
