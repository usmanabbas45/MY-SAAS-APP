/** Public changelog. Add a new entry at the top when you ship something customers will notice. */
export interface Release {
  date: string; // YYYY-MM-DD
  title: string;
  tag: "New" | "Improved" | "Fixed";
  items: string[];
}

export const RELEASES: Release[] = [
  {
    date: "2026-09-29", title: "Must-say rules and faster missing-reply alerts", tag: "Fixed",
    items: [
      "\"When a topic comes up, the answer must include\" rules now understand alternatives (\"pricing or plans\"), word forms and everyday wording, and are checked on every answer, even when the AI already flagged it for something else.",
      "Missing-reply alerts are now checked every minute, so you hear about an unanswered customer about a minute after your reply-time limit.",
    ],
  },
  {
    date: "2026-09-29", title: "Redesigned emails and instant founding offer", tag: "Improved",
    items: [
      "Every email (alerts, weekly summary, password reset, support replies) has a new clear, branded design with the key facts at a glance and a one-click button.",
      "Support tickets now get an instant confirmation email.",
      "Founding customers can claim their free Growth plan in one click. It starts right away and ends automatically, with a reminder a week before.",
    ],
  },
  {
    date: "2026-09-29", title: "Docs, status page, cookie choices and customer stories", tag: "New",
    items: [
      "Public docs and API reference at /docs.",
      "Live status page at /status showing the app, database, background checks, email and AI checking.",
      "Cookie banner: Google Analytics only loads after you accept, and you can change your choice any time.",
      "Customers can now share feedback from the dashboard. Approved stories appear on the homepage.",
    ],
  },
  {
    date: "2026-09-29", title: "Support center", tag: "New",
    items: [
      "Report an issue from /support or from Help & support in the dashboard, and track every ticket and reply.",
      "WhatsApp support button on every public page.",
    ],
  },
  {
    date: "2026-09-28", title: "Auto-renew switch", tag: "Improved",
    items: ["Turn auto-renew on or off from Plan & billing. It stays on by default, and turning it off keeps your plan until the end of the paid period."],
  },
  {
    date: "2026-09-28", title: "Smarter conversation checks and alert channels", tag: "New",
    items: [
      "Catches customers re-asking the same question, restarting the chat, fallback replies and contradictions.",
      "Missing-reply alerts when a customer writes and the bot never answers.",
      "Read-only Twilio connector for SMS and WhatsApp bots.",
      "\"Must say\" rules: require facts or disclaimers whenever a topic comes up.",
      "Notification channels (email, Slack, Microsoft Teams, Discord, Telegram, webhook) with severity and module filters.",
      "Latency, cost and error tracking for every bot reply.",
      "A free plan (50 conversations a month) and a Compliance plan for regulated businesses.",
    ],
  },
  {
    date: "2026-09-28", title: "Trust and privacy controls", tag: "New",
    items: [
      "Trust Center, Data Processing Agreement (GDPR) and About page.",
      "Per-project retention with auto-delete, results-only storage and an AI-off switch.",
      "Stronger masking: UK postcodes, number plates, names and your own custom words.",
    ],
  },
  {
    date: "2026-09-28", title: "Plans and billing", tag: "New",
    items: [
      "Paid plans with a 14-day free trial and a 14-day money-back guarantee, handled by Paddle.",
      "Manage your card, invoices and cancellation from the billing page.",
    ],
  },
  {
    date: "2026-09-27", title: "Accounts and client reports", tag: "Improved",
    items: [
      "Forgot password, account settings and one-click account deletion.",
      "Custom rules, frustration detection and white-label client reports (share link + PDF).",
      "Google Gemini available as an alternative AI checker.",
    ],
  },
  {
    date: "2026-09-27", title: "Live tracking", tag: "New",
    items: ["Watch every chatbot answer, agent run and workflow checked in real time with a clear working / problem feed."],
  },
  {
    date: "2026-09-27", title: "ProofMyAI launches", tag: "New",
    items: [
      "Chatbot audits against your own help articles, nightly bot tests, AI agent monitoring and n8n/Make monitoring.",
      "Fix list grouped by the help article that caused each problem.",
      "Neural risk model that learns from your own feedback.",
    ],
  },
];
