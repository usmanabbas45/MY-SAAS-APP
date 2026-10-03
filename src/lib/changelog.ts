/** Public changelog. Add a new entry at the top when you ship something customers will notice. */
export interface Release {
  date: string; // YYYY-MM-DD
  title: string;
  tag: "New" | "Improved" | "Fixed";
  items: string[];
}

export const RELEASES: Release[] = [
  {
    date: "2026-10-03", title: "Auto test generator", tag: "New",
    items: [
      "✨ On the Chatbot tests page, AI now writes test questions for you from your help articles, your rules and the questions your bot already got wrong, including prompt-injection and “talk to a human” checks.",
      "Review the suggestions and add them in one click. Paid plans get fresh suggestions every week when something changes.",
    ],
  },
  {
    date: "2026-10-03", title: "Invite & earn: give a month, get a month", tag: "New",
    items: ["Share your invite link from the new 🎁 Invite & earn page. When a friend becomes a paying customer, you both get your next month free."],
  },
  {
    date: "2026-10-03", title: "Yearly plans: 2 months free", tag: "New",
    items: [
      "Pay yearly and get 12 months for the price of 10. Switch between monthly and yearly any time on the Billing page; you only pay the difference.",
      "Clear prices before checkout: yearly plans show the full yearly amount, and every trial shows what you'll pay when it ends.",
      "Reminder emails 3 days before a free trial ends and 30 days before a yearly plan renews.",
    ],
  },
  {
    date: "2026-10-03", title: "Try ProofMyAI with demo data", tag: "New",
    items: [
      "✨ Try with demo data: open a sample online-shop project with audits, safety findings, a Fix with AI result, agent runs, workflow failures and uptime, before connecting anything.",
      "New accounts get three short getting-started emails (one-click unsubscribe). They stop as soon as you connect something.",
    ],
  },
  {
    date: "2026-10-03", title: "Email confirmation and daily backups", tag: "Improved",
    items: [
      "New accounts confirm their email address with one click, so alerts always reach a real inbox. Until then, alerts to other addresses and team invitations are paused.",
      "Your data is now backed up automatically every day, encrypted, with copies kept off the server.",
    ],
  },
  {
    date: "2026-10-03", title: "Fix with AI", tag: "New",
    items: [
      "Every fix-list item now has a ✨ Fix with AI button that writes the corrected help article from the real wrong answers, ready to paste into your bot.",
      "Save the corrected article to your ProofMyAI knowledge base in one click, so future checks use it.",
      "🛡️ Safe system prompt: a ready-to-paste prompt for your bot with prompt-injection protection, no made-up prices, human hand-over and language rules, built from what ProofMyAI found.",
    ],
  },
  {
    date: "2026-10-03", title: "Safety checks, uptime monitoring, team access and Intercom", tag: "New",
    items: [
      "Every answer is now checked for prompt-injection and jailbreak attempts, leaked system prompts, exposed card or bank numbers, rude replies and replies in the wrong language.",
      "Uptime & speed: add any chatbot, website or API URL and get an alert when it goes down, gets slow or comes back.",
      "Team: invite teammates or clients as viewers or editors. Viewers never see your API key.",
      "Intercom (Fin): connect with an access token and every bot reply is checked automatically, with no n8n or Make needed.",
    ],
  },
  {
    date: "2026-10-02", title: "One place to connect everything", tag: "New",
    items: [
      "New Connect page: pick your chatbot, AI agent or workflow tool and follow 3 numbered steps with copy buttons.",
      "A live status box turns green the moment your first data arrives, so you know it worked.",
      "New projects start with a simple “Connect your first AI” panel.",
    ],
  },
  {
    date: "2026-09-30", title: "Two-factor login, CAPTCHA and stronger passwords", tag: "New",
    items: [
      "Turn on two-factor authentication in Account with any authenticator app, with 10 one-time recovery codes.",
      "Sign-up, login and password reset are protected by a CAPTCHA that runs automatically in your browser.",
      "New passwords must be strong and are checked against known data breaches.",
      "You get an email when your account signs in from a new device, or when your password or 2FA changes.",
    ],
  },
  {
    date: "2026-09-30", title: "WhatsApp bot live monitoring", tag: "New",
    items: [
      "WAHA users can monitor every real WhatsApp conversation by adding one webhook, with reply-time and missing-reply alerts.",
      "Customer phone numbers used as chat ids are now replaced with anonymous codes.",
    ],
  },
  {
    date: "2026-09-30", title: "Guides for AI chatbot and automation quality", tag: "New",
    items: [
      "New guides: testing chatbot accuracy, catching hallucinations, monitoring n8n, Make and AI agents, and a chatbot QA checklist.",
      "An llms.txt summary so AI assistants describe ProofMyAI accurately.",
    ],
  },
  {
    date: "2026-09-30", title: "Your must-say rules count as approved information", tag: "Improved",
    items: [
      "Statements your \"must include\" rules require (for example \"Prices include VAT\") are now treated as approved company information, so a bot that follows your rule is never marked \"not in docs\" for it.",
      "The Privacy Policy and Trust Center now name only the AI provider actually in use.",
    ],
  },
  {
    date: "2026-09-30", title: "Stronger account protection and fair-use monitoring", tag: "Improved",
    items: [
      "Behind the scenes: AI usage is now tracked per account, which keeps plans affordable and lets us spot abuse quickly.",
      "Abusive or fake sign-ups can be blocked by email or domain, so spam accounts can't come back.",
    ],
  },
  {
    date: "2026-09-30", title: "AI checks now run on Claude Opus 5.5", tag: "Improved",
    items: ["Chatbot answers, agent runs and bot tests are graded by Anthropic's newest Opus model by default."],
  },
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
