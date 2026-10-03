/** Public site URL used for canonical links, sitemaps and social previews. */
export const SITE_URL = (process.env.APP_URL || "https://proofmyai.com").replace(/\/+$/, "");
export const SITE_NAME = "ProofMyAI";
/** Official profiles of the brand (YouTube, LinkedIn, X, GitHub, Product Hunt…) for search and AI engines. Set ORG_SAME_AS as a comma list. */
export const SAME_AS = [
  ...(process.env.ORG_SAME_AS ?? "").split(",").map((s) => s.trim()).filter((s) => /^https:\/\//.test(s)),
];
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "contact@usmanabbas.dev";
export const SITE_DESCRIPTION =
  "ProofMyAI checks your AI chatbot answers, AI agent runs and n8n/Make workflows, catches wrong answers, hallucinations and silent failures, and tells you exactly what to fix. Free AI audit.";

export const FAQS: { q: string; a: string }[] = [
  { q: "What does ProofMyAI do?", a: "ProofMyAI is a quality monitor for AI. It checks every answer your AI chatbot gives against your own help docs, watches your AI agents for loops, errors and runaway costs, and monitors n8n and Make workflows for failures and silent failures. When something breaks you get an alert and a clear fix list." },
  { q: "Which chatbots and tools does it work with?", a: "Any of them. Upload chat exports from Intercom, Tidio, Crisp, Zendesk, Chatbase or your own bot, connect any bot with an HTTP endpoint for nightly tests, send AI agent runs from LangChain, OpenAI, Claude or CrewAI with one API call, and connect n8n or Make with an API key or webhook." },
  { q: "How does it detect AI hallucinations?", a: "An AI judge (Claude or Google Gemini) compares each answer with your knowledge base and labels it correct, not in the docs, made up, should escalate to a human, off policy or unclear. Rule-based checks catch invented prices, missed escalations and over-promises even without an AI key." },
  { q: "Do I need to write code?", a: "No. Chatbot audits only need a file upload, n8n and Make connect with an API key, and alerts go to Slack, Discord, Teams or email. Developers can use the API for live tracking of chatbots and agents." },
  { q: "Is my customers' data safe?", a: "Personal data such as emails, phone numbers, card numbers, IBANs, UK postcodes, number plates and names is masked automatically before anything is stored or sent to an AI model, and you can add your own words to mask. Each project can keep results only (no conversation text), delete data automatically after 7 to 365 days, or switch the AI provider off. A GDPR / UK GDPR Data Processing Agreement is available, and self-hosting is possible for regulated businesses." },
  { q: "Can agencies use it for clients?", a: "Yes. Create one project per client, share read-only client reports with your own agency name, export PDF and CSV, and send weekly summary emails. The Agency plan covers up to 20 client projects." },
  { q: "How much does it cost?", a: "ProofMyAI is free for 50 conversations a month, no card needed. Paid plans start at $29 per month, and the Compliance plan for regulated businesses is $249. Pay yearly and get 2 months free (12 months for the price of 10). Every paid plan has a 14-day free trial and a 14-day money-back guarantee." },
  { q: "What is a silent failure in n8n or Make?", a: "A silent failure is a workflow run that reports success but produced nothing, for example an order sync that returned zero orders because an API changed. ProofMyAI flags these, along with failed runs, slow runs, error spikes and workflows that stopped running." },
];

export interface Solution {
  slug: string;
  title: string; // <title> and H1
  description: string; // meta description
  kicker: string;
  intro: string;
  problems: string[];
  steps: { title: string; text: string }[];
  features: string[];
  faqs: { q: string; a: string }[];
}

export const SOLUTIONS: Solution[] = [
  {
    slug: "ai-chatbot-monitoring",
    title: "AI Chatbot Monitoring & Hallucination Checker",
    description: "Monitor your AI chatbot's answers 24/7. ProofMyAI checks every reply against your help docs, catches hallucinations and missed escalations, and tells you which article to fix.",
    kicker: "AI chatbot monitoring",
    intro: "Your support chatbot answers customers day and night. ProofMyAI checks every answer against your own help docs so made-up prices, wrong policies and missed hand-overs are caught before they cost you refunds or customers.",
    problems: [
      "Bots confidently invent prices, delivery times and policies that are not in your docs",
      "Angry customers and legal threats are not handed over to a human",
      "Nobody has time to read thousands of transcripts",
      "Bot platforms have no independent quality control",
    ],
    steps: [
      { title: "Upload or connect", text: "Upload chat exports from Intercom, Tidio, Crisp or Zendesk, or send conversations live with one API call." },
      { title: "Every answer graded", text: "An AI judge compares each reply with your knowledge base: correct, made up, not in docs, should escalate or off policy." },
      { title: "Fix what matters", text: "A fix list groups wrong answers by the help article that caused them, and alerts reach Slack or email." },
    ],
    features: ["Hallucination detection against your own docs", "Missed-escalation and frustration detection", "Your own rules: “never say…”, “always hand over when…”", "Nightly regression tests for your bot", "Live tracking and instant alerts", "Client-ready reports and CSV export"],
    faqs: [
      { q: "How do I check if my chatbot is giving wrong answers?", a: "Upload a transcript export to ProofMyAI together with your help articles. Every answer is graded against your docs within minutes, and wrong or made-up answers are listed with the reason and the article to update." },
      { q: "Does it work with Intercom Fin, Tidio Lyro and Chatbase?", a: "Yes. Any chatbot works: export conversations as CSV or JSON, or send them live through the API or an n8n/Make webhook." },
    ],
  },
  {
    slug: "n8n-workflow-monitoring",
    title: "n8n & Make Workflow Monitoring and Alerts",
    description: "Get alerted when n8n or Make workflows fail, silently return nothing, slow down or stop running. Connect in two minutes with an API key or webhook.",
    kicker: "n8n & Make monitoring",
    intro: "n8n and Make don't warn you when an automation quietly stops working. ProofMyAI watches every execution and alerts you about failures, silent failures and workflows that simply stopped running.",
    problems: [
      "Workflows fail at night and nobody notices until a customer complains",
      "Runs report success but process zero orders or leads",
      "Triggers break and a workflow silently stops running",
      "Error emails are noisy and easy to miss",
    ],
    steps: [
      { title: "Connect", text: "Paste your n8n URL and API key, or your Make API token and scenario IDs. Or send executions by webhook." },
      { title: "Automatic checks", text: "Every 15 minutes ProofMyAI checks for failures, silent failures, slow runs, error-rate spikes and missing runs." },
      { title: "Fast alerts", text: "Get one clear alert in Slack, Discord, Teams or email within minutes (seconds with the optional webhook), and it resolves itself when the workflow recovers." },
    ],
    features: ["Failed and crashed execution alerts", "Silent failure detection (success with 0 output)", "“Stopped running” heartbeat alerts", "Error-rate spike detection", "Slow run detection vs. normal duration", "Per-workflow success rates"],
    faqs: [
      { q: "How do I get alerts when an n8n workflow fails?", a: "Connect n8n to ProofMyAI with an API key (n8n → Settings → n8n API). ProofMyAI checks executions every 15 minutes and alerts you on Slack or email. For instant alerts, add an Error Trigger workflow that posts to the ProofMyAI webhook." },
      { q: "Does it work with self-hosted n8n?", a: "Yes, as long as your n8n public API is reachable from the internet. You can also push executions to ProofMyAI with a webhook." },
    ],
  },
  {
    slug: "ai-agent-monitoring",
    title: "AI Agent Monitoring: Loops, Errors & Costs",
    description: "Monitor AI agents built with LangChain, OpenAI, Claude or CrewAI. Catch loops, tool errors, runaway costs, empty outputs and answers the tools never supported.",
    kicker: "AI agent monitoring",
    intro: "AI agents can loop, fail silently or burn through your budget. Send each run to ProofMyAI with one HTTP call and get a reliability score, clear issues and alerts.",
    problems: [
      "Agents get stuck calling the same tool again and again",
      "Tool errors hide behind a “success” status",
      "Costs per run creep up without anyone noticing",
      "Final answers claim results the tools never returned",
    ],
    steps: [
      { title: "One API call", text: "Send the run, with goal, steps, tool calls, costs and final output, when your agent finishes. Any framework works." },
      { title: "Checked instantly", text: "Loops, tool errors, empty output, budget, step and time limits, plus an AI review of whether the goal was met." },
      { title: "Score & alerts", text: "Each run gets a 0–100 score; problem runs raise incidents and alerts." },
    ],
    features: ["Loop detection", "Tool error and “ended on error” detection", "Cost, step and latency budgets", "Empty and ungrounded output checks", "Per-agent reliability and cost reports", "Works with any framework via HTTP"],
    faqs: [
      { q: "How do I monitor a LangChain or OpenAI agent in production?", a: "At the end of each run, POST the run (goal, steps and final output) to the ProofMyAI API. Copy-paste snippets for JavaScript, Python and cURL are in the dashboard." },
      { q: "Can it stop my agent from overspending?", a: "ProofMyAI flags every run that goes over your cost, step or time budget and alerts you, so you can fix prompts or tools before costs grow." },
    ],
  },
];

SOLUTIONS.push({
  slug: "ai-chatbot-compliance-monitoring",
  title: "AI Chatbot Compliance Monitoring for Dealers, Finance & Insurance",
  description: "Catch the chatbot answers that create liability: wrong cover and warranty claims, missed complaints and legal threats, unsafe advice and unanswered customers. Built for regulated businesses, with DPA, masking and results-only storage.",
  kicker: "Regulated businesses",
  intro: "When a car dealer's, broker's or insurer's chatbot gets it wrong, it's not just a bad answer. It can be a mis-sold warranty, an ignored complaint or a stranded customer told to drive. ProofMyAI catches the answers that could create legal or financial exposure, and keeps customer data under your control.",
  problems: [
    "The bot tells customers something is covered when your terms exclude it",
    "Complaints and legal threats get an ordinary reply instead of a hand-over",
    "Customers are asked again for their registration or details, or get no reply at all",
    "A bot contradicts safety advice it gave a minute earlier",
  ],
  steps: [
    { title: "Add your terms and rules", text: "Upload your policy wording and add rules like “windscreen => not covered” or “always hand over when a customer mentions complaint or solicitor”." },
    { title: "Connect safely", text: "Upload anonymised exports, connect WhatsApp/SMS through Twilio read-only, or send events. Masking, results-only storage and auto-delete are set per project." },
    { title: "Get a risk report", text: "See how many answers could have created legal or financial exposure, which rules were broken, unanswered customers and response times, with alerts for anything high-risk." },
  ],
  features: [
    "“Must say / never say” rules for cover, exclusions and promises",
    "Missed complaint, legal-threat and vulnerable-customer hand-overs",
    "Unanswered-message and failed-delivery alerts (WhatsApp/SMS)",
    "Re-asking, contradiction and fallback detection",
    "Masking of names, postcodes, number plates and your own terms",
    "Signed DPA, results-only storage, auto-delete, AI-off or self-hosted",
  ],
  faqs: [
    { q: "Can we use ProofMyAI under UK GDPR?", a: "Yes. You stay the data controller and ProofMyAI acts as your processor under our Data Processing Agreement. You can mask personal data, keep results only (no conversation text), delete data automatically and switch the AI provider off, or run ProofMyAI on your own server." },
    { q: "Does it replace our compliance review?", a: "No. It is an automated first line that flags risky answers quickly so your team can review and fix them. Results can be wrong, so high-risk findings should always be checked by a person." },
  ],
});

export function jsonLd(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}

export interface Video { id: string; title: string; description: string; duration: string; uploadDate: string }

export const VIDEOS = {
  marketing: {
    id: "1LWFQ3ROJ14",
    title: "Is Your AI Chatbot Lying to Customers? Catch It Before They Do | ProofMyAI",
    description: "ProofMyAI checks every AI chatbot answer, AI agent run and n8n/Make workflow, catches wrong answers and silent failures, and tells you exactly what to fix.",
    duration: "PT1M24S",
    uploadDate: "2026-09-28",
  },
  tutorial: {
    id: "j02a0DP3lPg",
    title: "How to Monitor Your AI Chatbot, AI Agents & n8n Workflows (Full Setup Tutorial) | ProofMyAI",
    description: "Step-by-step setup: run your first chatbot audit, read the fix list, add rules, share client reports, turn on live tracking and nightly tests, monitor AI agents and n8n/Make, and get alerts.",
    duration: "PT3M14S",
    uploadDate: "2026-09-28",
  },
} satisfies Record<string, Video>;

/** schema.org VideoObject so Google can show the video in search results. */
/** Self-hosted 75-second product demo (public/video). */
export const DEMO_VIDEO = {
  src: "/video/proofmyai-demo.mp4",
  webm: "/video/proofmyai-demo.webm",
  poster: "/video/proofmyai-demo-poster.jpg",
  title: "Is your AI chatbot lying to your customers? ProofMyAI in 75 seconds",
  description: "See how ProofMyAI connects in 2 minutes, flags wrong chatbot answers with the exact fix, catches AI agent loops and silent n8n/Make failures, and alerts you on Slack, email or WhatsApp.",
  duration: "PT1M15S",
  uploadDate: "2026-10-02",
};

export function demoVideoJsonLd() {
  return {
    "@type": "VideoObject",
    name: DEMO_VIDEO.title,
    description: DEMO_VIDEO.description,
    thumbnailUrl: [`${SITE_URL}${DEMO_VIDEO.poster}`],
    uploadDate: DEMO_VIDEO.uploadDate,
    duration: DEMO_VIDEO.duration,
    contentUrl: `${SITE_URL}${DEMO_VIDEO.src}`,
  };
}

export function videoJsonLd(v: Video) {
  return {
    "@type": "VideoObject",
    name: v.title,
    description: v.description,
    thumbnailUrl: [`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`],
    uploadDate: v.uploadDate,
    duration: v.duration,
    embedUrl: `https://www.youtube.com/embed/${v.id}`,
    contentUrl: `https://www.youtube.com/watch?v=${v.id}`,
  };
}
