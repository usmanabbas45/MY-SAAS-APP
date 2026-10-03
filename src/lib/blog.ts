/**
 * Blog guides. Written answer-first (the first paragraph answers the title's question directly) so search
 * engines can use it as a snippet and AI answer engines can quote it. Body uses the Markdown subset in
 * components/prose.tsx. Add new posts at the top.
 */
export interface Post {
  slug: string;
  title: string;
  /** Shorter title for Google (about 60 characters) when the headline is longer. */
  seoTitle?: string;
  description: string;
  date: string;
  updated?: string;
  readMins: number;
  tags: string[];
  /** One- or two-sentence direct answer shown first and used in llms.txt. */
  answer: string;
  body: string;
  takeaways: string[];
  faqs: { q: string; a: string }[];
  cta: { text: string; href: string };
}

export const POSTS: Post[] = [
  {
    slug: "how-to-test-ai-chatbot-accuracy",
    title: "How to Test an AI Chatbot for Accuracy (Step-by-Step Guide)",
    description: "A practical, repeatable process to test whether your AI chatbot gives correct answers: build a test set from real questions, grade answers against your own docs, and monitor quality every day.",
    date: "2026-09-30",
    readMins: 8,
    tags: ["AI chatbots", "Testing", "Quality"],
    answer: "To test an AI chatbot for accuracy, collect real customer questions, write down the facts a correct answer must contain, ask the bot each question, and grade every answer against your own help documentation. Repeat the test after every change to the bot, its prompt or its knowledge base, and monitor live conversations for answers that are made up or not supported by your docs.",
    body: `
## Why chatbot accuracy needs its own test

AI chatbots don't fail like normal software. They rarely crash; instead they answer confidently and wrongly. A bot can quote an old price, invent a refund rule, or promise a delivery time your business never offered, and nothing in your logs will look like an error. The only way to know is to check what the bot actually says against what is actually true for your business.

That is why accuracy testing has two parts: a **fixed test set** you run on purpose, and **monitoring** of real conversations after launch.

## Step 1: Collect real questions

Start with questions customers really ask, not questions you imagine. The best sources are:

- Exports from your chat platform (Intercom, Zendesk, Tidio, Crisp, Chatbase or your own logs)
- Your support inbox and the questions your team answers every day
- Search terms on your help centre

Pick 20 to 50 questions that cover your most important topics: pricing, delivery, refunds, cancellations, opening hours, product limits, and anything with legal or financial risk.

## Step 2: Write the expected facts, not the expected sentence

For each question, write the **facts a correct answer must contain**, not the exact wording. The bot can phrase things in many ways; what matters is whether the facts are right.

- Question: "How much is shipping to Germany?"
- Must contain: "€9.90", "3 to 5 business days"
- Must NOT contain: "free shipping"

Adding "must not say" facts is important: it catches the most dangerous mistakes, such as promising something you don't offer.

## Step 3: Ask the bot and grade every answer

Send each question to the bot and compare the answer with the expected facts and with your help articles. Use a small set of clear verdicts:

1. **Correct**: matches your docs.
2. **Not in docs**: the claim might be true, but nothing in your documentation supports it.
3. **Made up**: contradicts your docs or invents specifics like prices, dates or policies.
4. **Should escalate**: the customer needed a human (a complaint, a legal threat, a refund dispute) and the bot kept talking.
5. **Off policy**: breaks one of your rules, for example mentioning a competitor.

Grading by hand works for a first test. For anything larger, use an automated grader (a tool that uses an AI model to compare each answer against your documentation), and review a sample of its verdicts yourself.

## Step 4: Fix the source, not the symptom

When an answer is wrong, find **why**. In most cases the bot is repeating something outdated or missing from your help articles. Group the wrong answers by the article that caused them, and fix the articles that cause the most errors first. One outdated "Shipping rates" page can be behind dozens of wrong answers.

## Step 5: Re-test after every change

Run the same test set again after you change the bot's prompt, model, settings or knowledge base. This is regression testing: it shows whether a fix in one place broke something elsewhere. Running it automatically every night catches problems caused by changes you didn't make, such as a platform update.

## Step 6: Monitor real conversations

A test set only covers the questions you thought of. Real customers ask everything else. After launch, check a sample of live conversations, or better, check every answer automatically and get an alert when the bot makes something up, fails to hand over to a human, or stops replying.

> **Tip:** the fastest start is to upload a recent chat export together with your help articles. You get a list of wrong answers and the articles to fix within minutes, before writing a single test.

## How often should you test?

- **Before launch:** the full test set.
- **After any change:** the full test set.
- **Every night:** the most important questions (pricing, refunds, legal topics).
- **Always:** live monitoring with alerts.

## How ProofMyAI does this

[ProofMyAI](/solutions/ai-chatbot-monitoring) grades every chatbot answer against your own help articles, runs your test questions every night, and alerts you by email, Slack or WhatsApp when an answer is wrong. Start with a [free audit](/signup) of a chat export.
`,
    takeaways: [
      "Test with real customer questions and the facts a right answer must contain.",
      "Grade answers against your own documentation: correct, not in docs, made up, should escalate, off policy.",
      "Fix the help article behind the wrong answers, then re-test after every change.",
      "Monitor live conversations, because customers ask questions your test set doesn't cover.",
    ],
    faqs: [
      { q: "How many test questions do I need?", a: "Start with 20 to 50 real questions covering pricing, delivery, refunds, cancellations and anything with legal or financial risk. Add a new question every time a customer finds a wrong answer." },
      { q: "Can I test a chatbot automatically?", a: "Yes. Send each test question to the bot's API and grade the answers automatically against the expected facts and your help articles. Tools like ProofMyAI run this every night and alert you when an answer gets worse." },
      { q: "What is the most common cause of wrong chatbot answers?", a: "Outdated or missing information in the help articles the bot uses. Fixing the article usually fixes many wrong answers at once." },
    ],
    cta: { text: "Run a free accuracy audit of your chatbot", href: "/signup" },
  },
  {
    slug: "ai-chatbot-hallucination-examples",
    title: "AI Chatbot Hallucinations: Real Examples and How to Catch Them",
    description: "What AI chatbot hallucinations look like in customer service, the well-known cases that made the news, why they happen, and a practical system to catch them before customers do.",
    date: "2026-09-30",
    readMins: 7,
    tags: ["AI chatbots", "Hallucinations", "Risk"],
    answer: "An AI chatbot hallucination is an answer that sounds confident but is false or not supported by the business's own information, such as an invented refund rule, a wrong price or a policy that doesn't exist. You catch them by checking every answer against your documentation, alerting on made-up claims, and fixing the articles that cause them.",
    body: `
## What a hallucination looks like in customer service

In customer service, hallucinations are rarely dramatic. They look like normal, helpful answers:

- A shipping price or delivery time that is out of date
- A refund or cancellation rule that doesn't exist
- A discount, warranty or feature the business never offered
- A made-up link, phone number or opening hours
- Legal, medical or financial statements the business would never approve

Because the answer sounds right, customers believe it, and the business often only finds out when someone complains.

## Well-known cases

Several chatbot mistakes became public and show the business risk:

- **Air Canada (2024):** a customer was told by the airline's chatbot that he could claim a bereavement discount after travelling. That wasn't the airline's policy. A Canadian tribunal ruled that the airline was responsible for what its chatbot said and had to compensate the customer.
- **A Chevrolet dealership (2023):** users got a dealership's website chatbot to "agree" to sell a car for one dollar, and screenshots spread widely online.
- **DPD (2024):** a parcel company's chatbot was prompted into swearing and criticising the company, and the company disabled part of the bot.
- **New York City's MyCity chatbot (2024):** journalists reported that the city's business-advice chatbot gave answers that contradicted local laws.

The lesson from all of them: **the business owns what its bot says**, and problems are found by customers or the press unless you check first.

## Why chatbots make things up

- **Missing information:** when the help articles don't answer the question, the model fills the gap with something plausible.
- **Outdated information:** old prices or policies still sit in the knowledge base.
- **Conflicting information:** two articles say different things and the bot picks one.
- **Over-helpful prompts:** instructions like "always give a helpful answer" push the bot to answer instead of saying "I don't know".
- **Manipulation:** users deliberately push the bot to say things it shouldn't.

## How to catch hallucinations

1. **Ground every check in your own docs.** A general fact-check doesn't help; the question is whether the answer matches *your* policies.
2. **Separate "made up" from "not in docs".** A made-up answer contradicts your docs; a "not in docs" answer might be true but isn't supported. Both need attention, the first urgently.
3. **Check every answer, not a sample.** Hallucinations are rare per answer but common across thousands of conversations.
4. **Alert on high-risk topics.** Prices, refunds, legal and medical topics deserve an instant alert.
5. **Add rules.** "Never say lifetime warranty", "always hand over to a human when a customer mentions a chargeback", "when pricing comes up, say prices include VAT".
6. **Fix the cause.** Group problems by the article behind them and update that article.

## How to reduce hallucinations

- Keep help articles current and remove contradictions.
- Tell the bot to say "I don't know, let me connect you with our team" when the docs don't cover a question.
- Hand over to a human for complaints, legal threats and refund disputes.
- Re-test after every change to the prompt, model or knowledge base.

> Hallucinations can't be reduced to zero with today's models, but they can be caught within minutes instead of weeks.

## How ProofMyAI helps

[ProofMyAI](/solutions/ai-chatbot-monitoring) checks each chatbot answer against your help articles, labels it correct, not in docs, made up, should escalate or off policy, and alerts you about the dangerous ones. For regulated businesses there is a [compliance setup](/solutions/ai-chatbot-compliance-monitoring) with masking and results-only storage.
`,
    takeaways: [
      "A hallucination is a confident answer that isn't backed by your business's own information.",
      "Courts and the public hold businesses responsible for what their chatbot says.",
      "Most hallucinations come from missing, outdated or conflicting help articles.",
      "Check every answer against your docs, alert on high-risk topics, and fix the source article.",
    ],
    faqs: [
      { q: "Can you stop an AI chatbot from hallucinating completely?", a: "No model is hallucination-free today. You can reduce them with current, consistent help articles and a clear 'I don't know' instruction, and catch the rest quickly with automatic checks and alerts." },
      { q: "Is a business responsible for what its chatbot says?", a: "In the Air Canada case in 2024, a Canadian tribunal held the airline responsible for incorrect information its chatbot gave a customer. Treat your chatbot's answers as statements from your business." },
      { q: "What's the difference between 'made up' and 'not in docs'?", a: "A made-up answer contradicts your documentation or invents specifics. A 'not in docs' answer may be true but nothing in your documentation supports it. Both should be reviewed; made-up answers are more urgent." },
    ],
    cta: { text: "Find your chatbot's made-up answers for free", href: "/signup" },
  },
  {
    slug: "n8n-workflow-monitoring",
    title: "n8n Workflow Monitoring: Get Alerts for Failures and Silent Failures",
    seoTitle: "n8n Workflow Monitoring: Alerts for Failed & Silent Runs",
    description: "How to monitor n8n workflows in production: error workflows, execution checks, silent failures that report success, workflows that stop running, and alerts in Slack, email or WhatsApp.",
    date: "2026-09-30",
    readMins: 7,
    tags: ["n8n", "Automation", "Monitoring"],
    answer: "To monitor n8n workflows, catch three kinds of problems: executions that fail, executions that 'succeed' but produce nothing (silent failures), and workflows that stop running altogether. Use an n8n Error Workflow for instant failure alerts, check executions through the n8n API for zero-output runs and error spikes, and set a heartbeat that alerts you when a workflow hasn't run for longer than expected.",
    body: `
## The three ways n8n workflows break

1. **Failed executions:** a node throws an error (an API is down, credentials expired, data is in the wrong format).
2. **Silent failures:** the execution finishes with "success", but did nothing useful. For example, an order sync returns zero orders because an API changed a field name.
3. **Workflows that stop running:** a trigger breaks, a webhook URL changes, or someone deactivates the workflow, and nothing runs at all.

Most teams only watch the first kind. The second and third are usually found days later, by a customer or a colleague asking "why is this data missing?"

## Instant alerts for failed executions: the Error Workflow

n8n has a built-in feature for this:

1. Create a new workflow that starts with the **Error Trigger** node.
2. Add a notification node (Slack, email, Telegram or an HTTP request).
3. In each production workflow, open **Settings → Error workflow** and choose the workflow you just made.

Now every failed execution sends an alert with the workflow name and error message. It's free and takes five minutes, so do it first.

## Catch silent failures

An Error Workflow can't see silent failures, because nothing failed. To catch them:

- **Check the output count.** For each important workflow, decide what "normal" looks like (for example "at least 1 order per hour on weekdays") and alert when a successful execution produces zero items.
- **Compare with history.** A run that processes 3 items when it usually processes 300 deserves a look.
- **Watch duration.** A run that takes 10 times longer than normal is often about to fail.

## Catch workflows that stopped running

Set a **heartbeat** per workflow: "alert me if this workflow hasn't run for 2 hours". This catches broken triggers, deactivated workflows and a stopped n8n instance. Pick the window based on the schedule: a workflow that runs every 15 minutes might get a 1-hour window, a daily report a 26-hour window.

## Watch error rates, not just single errors

One failed execution in a thousand can be noise. A jump from 1% to 30% failed runs within an hour is an incident. Alerting on the error rate avoids alert fatigue while still catching real outages.

## A practical n8n monitoring checklist

- Error Workflow connected to every production workflow
- Zero-output alert for workflows that must always produce data
- Heartbeat alert for scheduled and webhook workflows
- Error-rate alert per workflow
- Alerts sent where you'll actually see them (Slack, WhatsApp or SMS, not only email)
- A weekly summary of success rates

## How ProofMyAI monitors n8n

[ProofMyAI](/solutions/n8n-workflow-monitoring) connects to n8n with an API key (n8n → Settings → n8n API), reads your executions every 15 minutes and alerts you on failures, silent failures, error-rate spikes, slow runs and workflows that stopped running. For faster alerts, it can also receive executions through a webhook. See the [setup docs](/docs#no-code).
`,
    takeaways: [
      "n8n workflows fail in three ways: errors, silent failures and simply not running.",
      "Set up an Error Workflow first: it's free and catches failed executions instantly.",
      "Alert on zero output and unusual counts to catch silent failures.",
      "Use a heartbeat per workflow to catch broken triggers and stopped instances.",
    ],
    faqs: [
      { q: "Does n8n have built-in alerts?", a: "Yes. The Error Trigger node lets you build an Error Workflow that runs whenever another workflow fails. It doesn't catch silent failures or workflows that stop running, so add output and heartbeat checks." },
      { q: "What is a silent failure in n8n?", a: "An execution that finishes successfully but produces nothing useful, for example a sync that returns zero records because an API response changed." },
      { q: "Does monitoring work with self-hosted n8n?", a: "Yes. Monitoring through the n8n API works with n8n Cloud and self-hosted n8n, as long as the API is reachable from the monitoring service." },
    ],
    cta: { text: "Connect n8n and get alerts in 2 minutes", href: "/signup" },
  },
  {
    slug: "make-com-scenario-monitoring",
    title: "Make.com Scenario Monitoring: Catch Errors and Scenarios That Stop Running",
    seoTitle: "Make.com Scenario Monitoring: Catch Errors & Stopped Runs",
    description: "How to monitor Make (formerly Integromat) scenarios: error handlers, incomplete executions, silent failures, scenarios that get disabled, and alerts that reach you in time.",
    date: "2026-09-30",
    readMins: 6,
    tags: ["Make", "Automation", "Monitoring"],
    answer: "To monitor Make.com scenarios, combine Make's built-in error handling and email notifications with checks that Make doesn't do for you: scenarios that run but process nothing, scenarios that are switched off automatically after repeated errors, and scenarios whose trigger stops firing. Check scenario logs through the Make API and alert when a scenario hasn't run or has an unusual error rate.",
    body: `
## What Make does for you

Make has useful built-in tools:

- **Error handlers** (Resume, Ignore, Break, Commit, Rollback) on individual modules
- **Incomplete executions**, which store failed runs so you can retry them
- **Email notifications** about errors and deactivated scenarios

Set these up first. They are the foundation.

## What Make doesn't tell you clearly

- **A scenario that stops running.** If a webhook stops receiving data or a schedule is changed, nothing fails, so nothing alerts.
- **A scenario that is switched off.** Make can deactivate a scenario after repeated errors. The email is easy to miss, and the automation is simply off until someone notices.
- **Silent failures.** A run "succeeds" but processes zero bundles because a filter or a changed API field drops everything.
- **Slow degradation.** More and more runs fail, but never enough to feel like an outage.

## A monitoring setup that works

1. **Turn on error notifications** in your Make profile and send them to an address you actually read.
2. **Add error handlers** to modules that call external APIs, and route errors to a Slack or email module.
3. **Track operations per run.** A scenario that normally processes 50 bundles and suddenly processes 0 needs a look.
4. **Add a heartbeat.** Alert when an important scenario hasn't run for longer than its normal schedule.
5. **Watch the error rate** per scenario over the last 24 hours.
6. **Send a weekly summary** of success rates to whoever owns the automations.

## Using the Make API

Make's API lets you read scenario status and execution logs with a token (Profile → API access, with the scenarios:read scope). A monitoring tool can poll it regularly, calculate error rates and detect scenarios that stopped, without changing your scenarios at all.

## How ProofMyAI monitors Make

[ProofMyAI](/solutions/n8n-workflow-monitoring) connects to Make with a read-only API token and your scenario IDs, checks their logs every 15 minutes and alerts you about failures, silent failures, error spikes and scenarios that stopped running, by Slack, email, Teams, Telegram or WhatsApp. See the [setup steps](/docs#no-code).
`,
    takeaways: [
      "Use Make's error handlers, incomplete executions and notifications first.",
      "Make won't clearly warn you about scenarios that stop running or process nothing.",
      "Add heartbeat, zero-output and error-rate checks for important scenarios.",
      "A read-only API token is enough for outside monitoring.",
    ],
    faqs: [
      { q: "Why did my Make scenario turn off?", a: "Make can deactivate a scenario after repeated consecutive errors. Check the scenario's history for the errors, fix the cause, and switch it back on. A heartbeat alert tells you when this happens." },
      { q: "Can I get Make error alerts in Slack?", a: "Yes. Add an error handler route with a Slack module, or use a monitoring tool that reads the Make API and sends alerts to Slack, Teams, email or WhatsApp." },
      { q: "Does monitoring change my scenarios?", a: "No. Monitoring through the Make API only reads scenario logs with a read-only token." },
    ],
    cta: { text: "Monitor your Make scenarios free", href: "/signup" },
  },
  {
    slug: "ai-agent-monitoring",
    title: "AI Agent Monitoring: How to Catch Loops, Tool Errors and Runaway Costs",
    seoTitle: "AI Agent Monitoring: Catch Loops, Tool Errors & Costs",
    description: "What can go wrong with AI agents in production and how to monitor them: loops, failed tool calls, ungrounded answers, goals not met, slow runs and cost spikes.",
    date: "2026-09-30",
    readMins: 7,
    tags: ["AI agents", "Monitoring", "LLM"],
    answer: "To monitor AI agents, record every run with its goal, steps (model calls and tool calls), errors, duration, cost and final output, then check each run automatically for loops, failed tool calls, empty output, budget or step limits being exceeded, and final answers that the tool results don't support. Alert on high-severity issues and review a sample of runs every week.",
    body: `
## Why agents need different monitoring

A normal program either works or throws an error. An AI agent can do something much stranger: call the same tool twenty times, give up silently, spend ten dollars on one request, or report "done" when the task wasn't done. Traditional uptime monitoring sees none of this.

## What to record for each run

- **Goal:** what the agent was asked to do
- **Steps:** each model call and tool call, with inputs, outputs and errors
- **Duration and cost** per step and in total
- **Status:** success, error, timeout, cancelled
- **Final output:** what the agent returned

Most agent frameworks (LangChain, the OpenAI Agents SDK, the Claude Agent SDK, CrewAI) make these easy to collect at the end of a run.

## The checks that matter

1. **Loops:** the same tool called repeatedly with the same input. This is the most common costly failure.
2. **Tool errors:** failed API calls, timeouts and permission errors, especially when the agent ignores them.
3. **Ended on an error but reported success:** the last step failed but the run says "success".
4. **Empty output:** a successful run with nothing in the final answer (a silent failure).
5. **Limits:** too many steps, too long, or more expensive than your budget per run.
6. **Goal not met:** the final output doesn't do what the goal asked.
7. **Ungrounded output:** the agent claims results the tools never returned, for example "refund issued" when the refund call failed.

The first five can be checked with simple rules. The last two need an AI review that reads the goal, the steps and the output.

## Set limits per agent

Decide per agent what "normal" means: maximum steps, maximum seconds and maximum cost per run. A support agent might need 10 steps and 30 seconds; a research agent might need 60 steps and 5 minutes. Alerts based on your own limits are far more useful than generic ones.

## Alerting without noise

- Alert immediately on high-severity issues: loops, runs over budget, goal not met, ungrounded claims.
- Group repeated issues into one incident per agent and problem, and close it automatically when runs are healthy again.
- Send a weekly summary with the success rate, average cost and the most common issues.

## How ProofMyAI monitors agents

[ProofMyAI](/solutions/ai-agent-monitoring) takes one HTTP call at the end of each run (see the [API docs](/docs#agent-runs)), checks it for loops, tool errors, limits, empty output, goals not met and ungrounded claims, gives each run a score, and alerts you when something needs attention.
`,
    takeaways: [
      "Record the goal, every step, errors, duration, cost and final output of each run.",
      "Rules catch loops, tool errors, empty output and limit breaches.",
      "An AI review catches goals not met and claims the tools never supported.",
      "Set limits per agent and alert only on what matters.",
    ],
    faqs: [
      { q: "What is the most common AI agent failure?", a: "Loops: the agent calls the same tool with the same input again and again, wasting time and money without making progress." },
      { q: "How do I stop an AI agent from overspending?", a: "Set a maximum number of steps, maximum run time and maximum cost per run in your agent code, and alert when a run exceeds them." },
      { q: "Which frameworks can be monitored?", a: "Any framework. Send the run's goal, steps, final output, status, duration and cost with one HTTP call at the end of the run." },
    ],
    cta: { text: "Monitor your AI agents free", href: "/signup" },
  },
  {
    slug: "chatbot-qa-checklist",
    title: "AI Chatbot QA Checklist: 25 Checks Before and After Launch",
    description: "A practical quality checklist for AI customer-service chatbots: knowledge base, accuracy, escalation, safety, privacy, performance and ongoing monitoring.",
    date: "2026-09-30",
    readMins: 6,
    tags: ["AI chatbots", "Checklist", "Quality"],
    answer: "Before launching an AI chatbot, check that its knowledge base is current, that it answers your most common questions correctly, that it hands complaints and risky topics to a human, that it can't be pushed into saying things you don't allow, and that personal data is protected. After launch, monitor every answer and re-test after every change.",
    body: `
## Knowledge base

- Every important topic has one current article (pricing, delivery, refunds, cancellations, opening hours).
- No two articles contradict each other.
- Old promotions and discontinued products are removed.
- Articles state limits clearly ("we don't ship to…", "not covered by warranty").

## Accuracy

- The bot answers your 20 most common questions correctly.
- Prices, dates and numbers match your articles exactly.
- The bot says "I don't know" instead of guessing when the articles don't cover a question.
- Answers don't invent links, phone numbers or email addresses.
- Required statements appear where needed (for example "prices include VAT").

## Escalation to a human

- Complaints are handed to a human.
- Legal threats and chargebacks are handed to a human.
- Refund disputes are handed to a human.
- Angry customers (all caps, repeated questions) are handed over quickly.
- The hand-over actually works and someone receives it.

## Safety and policy

- The bot never mentions competitors or makes guarantees you don't offer.
- It refuses to agree to prices, discounts or contracts.
- It resists "ignore your instructions" style manipulation.
- It doesn't give medical, legal or financial advice unless you allow it.

## Privacy

- Customers are told they are talking to an AI.
- Personal data (emails, phone numbers, card numbers) is masked in logs and reports.
- Conversation data is deleted after a set period.

## Performance

- Replies arrive within a few seconds.
- The bot replies to every message (no silent drop-outs).

## After launch

- Every answer is checked against your docs, with alerts for made-up answers.
- Your key questions are re-tested every night and after every change.
- A weekly summary shows accuracy, escalations and the articles to fix.

> Print this list and tick it off before every major change to your bot, not just at launch.

## Automate the checklist

Many of these checks can run automatically. [ProofMyAI](/solutions/ai-chatbot-monitoring) grades answers against your docs, enforces your own rules ("never say…", "always hand over when…", "must say…"), detects frustrated customers and missing replies, masks personal data, and alerts you. [Try it free](/signup).
`,
    takeaways: [
      "Most chatbot quality problems start in the knowledge base.",
      "Test your top 20 questions, escalation paths and 'never say' rules before launch.",
      "Protect personal data and tell customers they're talking to an AI.",
      "After launch, check every answer and re-test after every change.",
    ],
    faqs: [
      { q: "What should I test before launching an AI chatbot?", a: "Your most common questions, pricing and policy answers, hand-over to a human for complaints and legal topics, 'never say' rules, resistance to manipulation, and personal-data masking." },
      { q: "How often should a chatbot be tested?", a: "Before launch, after every change to its prompt, model or knowledge base, every night for the most important questions, and continuously through live monitoring." },
      { q: "Who should own chatbot quality?", a: "Usually the support or customer-experience lead, with the developer who maintains the bot. A weekly quality summary keeps both informed." },
    ],
    cta: { text: "Automate your chatbot QA checklist", href: "/signup" },
  },
];

export const postBySlug = (slug: string) => POSTS.find((p) => p.slug === slug);
