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
    description: "Langfuse is an open-source LLM engineering platform for developers. ProofMyAI is no-code chatbot, agent, n8n/Make, Sheets and CRM monitoring for businesses and agencies. Compare features, setup and who each is for.",
    summary: "Langfuse is an excellent open-source platform for engineering teams who instrument their own LLM code with tracing, prompt management and evaluations. ProofMyAI is built for the people who run a support chatbot or automations and don't want to write code: it checks every customer answer against your help docs, tells you what to fix, and also watches n8n/Make workflows, Google Sheets and CRMs.",
    rows: [
      ["Built for", "Business owners, support teams and agencies", "Developers and AI engineering teams"],
      ["Setup", "No code: upload chat exports, paste an Intercom token, add a WhatsApp webhook or n8n/Make key", "Add the SDK or OpenTelemetry instrumentation to your application code"],
      ["Checks chatbot answers against your help docs", "Built in and automatic for every answer", "Possible by setting up your own LLM-as-a-judge evaluators"],
      ["Tells you what to fix", "Fix list per help article, plus ✨ corrected article and safer system prompt", "Not a focus: you analyse traces and scores"],
      ["n8n & Make workflow monitoring", "Yes: failures, silent failures, stopped workflows", "Not a focus"],
      ["Tracing, prompt management, experiments", "Agent runs with step-by-step timing, tokens and errors; accepts OpenTelemetry traces; no prompt management", "Yes, extensive"],
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
    description: "LangSmith is LangChain's developer platform for tracing, testing and evaluating LLM apps. ProofMyAI is no-code monitoring for support chatbots, AI agents, n8n/Make workflows and CRMs. See the differences.",
    summary: "LangSmith, from the LangChain team, helps developers debug, test and evaluate LLM applications and agents. ProofMyAI is for businesses and agencies who run chatbots and automations: connect without code, get every customer answer checked against your own docs, and receive a fix list and alerts.",
    rows: [
      ["Built for", "Business owners, support teams and agencies", "Developers building LLM apps and agents"],
      ["Setup", "No code for chatbots and workflows; one HTTP call for agents", "SDK / tracing integration in your code"],
      ["Checks chatbot answers against your help docs", "Built in and automatic", "Possible with custom evaluators and datasets"],
      ["Tells you what to fix", "Fix list per article, ✨ corrected articles and safer prompts", "Not a focus: you inspect traces and evaluation results"],
      ["n8n & Make workflow monitoring", "Yes", "Not a focus"],
      ["Debugging, datasets, prompt hub", "Agent step timeline and OpenTelemetry traces; CI regression tests via API; no prompt hub", "Yes, extensive"],
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
  {
    slug: "braintrust-alternative",
    name: "Braintrust",
    title: "ProofMyAI vs Braintrust: no-code AI monitoring vs an AI evals platform",
    description: "Braintrust is an evaluation and observability platform for teams building AI products. ProofMyAI is no-code monitoring for live chatbots, AI agents, n8n/Make, Sheets and CRMs. Compare.",
    summary: "Braintrust is built for AI product and engineering teams: run evaluations, compare prompts and models, log production traces and score them. ProofMyAI is built for the business running the AI: every live customer answer checked against your own help docs, a fix list, pre-send blocking, one-click approvals, and monitoring for the automations, sheets and CRMs around the AI.",
    rows: [
      ["Built for", "Business owners, support teams, automation builders and agencies", "AI product and engineering teams"],
      ["Setup", "No code for chatbots, n8n/Make, Sheets and CRMs; one HTTP call or OpenTelemetry for agents", "SDK and logging in your code"],
      ["Checks live answers against your help docs", "Built in, with the exact quote from your docs as evidence", "Possible with custom scorers"],
      ["Pre-send check and human approvals", "Built in: allow / review / block, and one-click approval for risky agent actions", "Not a focus"],
      ["Evaluations, experiments, prompt playground", "Nightly and CI regression tests on your own questions", "Yes, extensive"],
      ["n8n, Make, Google Sheets and CRM monitoring", "Yes: failures, silent failures, stopped workflows, missing leads", "Not a focus"],
      ["Alerts", "WhatsApp, Slack, Teams, Discord, Telegram, email, webhooks", "Configurable via the platform"],
      ["Pricing", "Free plan; paid from $29/month", "Free tier; paid plans (see their site)"],
    ],
    chooseUs: ["You run a customer-facing chatbot or agent and want every answer checked without building evals", "You want plain-English fixes and alerts on WhatsApp or Slack", "Your AI sits inside n8n, Make, Sheets or a CRM", "You're an agency reporting to clients"],
    chooseThem: ["You're building an AI product and iterate on prompts and models with experiments", "You need a full evaluation workflow with datasets and custom scorers", "Your users are mainly engineers"],
    faqs: [
      { q: "Is ProofMyAI a Braintrust alternative?", a: "For businesses that want live monitoring and fixes without building an evaluation pipeline, yes. Teams that run systematic experiments on prompts and models will prefer Braintrust, and some use both." },
      { q: "Can ProofMyAI run regression tests before I deploy?", a: "Yes. Save your important questions with the facts a right answer must include, and call POST /api/v1/test-runs from CI (for example a GitHub Action) against a preview URL. The build fails if answers get worse." },
    ],
  },
  {
    slug: "helicone-alternative",
    name: "Helicone",
    title: "ProofMyAI vs Helicone: answer quality monitoring vs LLM request logging",
    description: "Helicone is an open-source LLM observability gateway for logging requests, costs and latency. ProofMyAI checks whether live AI answers and automations are actually right. Compare.",
    summary: "Helicone sits between your app and the model provider and logs every request: cost, latency, errors and usage, with caching and rate limiting. ProofMyAI looks at what the AI said and did: whether each answer matches your help docs and policies, whether an agent did the job, and whether the workflows, sheets and CRMs around it still work.",
    rows: [
      ["Built for", "Business owners, support teams and agencies", "Developers who want request logging and cost control"],
      ["Setup", "No code for chatbots and workflows; one HTTP call or OpenTelemetry for agents", "Change the model base URL or add headers in your code"],
      ["Logs every model request, cost and latency", "Per reply and per agent step when you send them", "Yes, core feature"],
      ["Checks answers against your help docs", "Built in, with the exact quote from your docs as evidence", "Not a focus"],
      ["Blocks wrong answers before they're sent", "Yes: POST /check returns allow, review or block", "Not a focus"],
      ["n8n, Make, Google Sheets and CRM monitoring", "Yes", "Not a focus"],
      ["Open source / self-hosting", "Self-hosted option for regulated businesses", "Open source and self-hostable"],
      ["Pricing", "Free plan; paid from $29/month", "Free tier; paid plans (see their site)"],
    ],
    chooseUs: ["You care whether answers are right, not only how much they cost", "You want alerts and a fix list without code", "You also run automations, sheets or a CRM"],
    chooseThem: ["You mainly need request logs, cost tracking, caching and rate limits", "You want an open-source gateway in front of your model provider"],
    faqs: [
      { q: "Is ProofMyAI a Helicone alternative?", a: "They solve different problems and work well together: Helicone logs and controls model requests; ProofMyAI checks whether the answers and actions were correct and alerts you when they weren't." },
      { q: "Does ProofMyAI track AI costs?", a: "Yes, per reply (send cost_usd) and per agent step, with alerts on runaway agent costs. It is not a proxy, so it doesn't cache or rate-limit requests." },
    ],
  },
];
