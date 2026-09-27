# ProofMyAI: complete step-by-step guide

Written for Muhammad Usman. Follow the parts in order. Each step says exactly what to click.

| Part | What you will do | Time |
|---|---|---|
| A | Run ProofMyAI on your own computer | 20 min |
| B | Turn on the AI judge (Claude API key) | 10 min |
| C | Put it online (Railway) | 30 min |
| D | Turn on automatic checks (cron) | 5 min |
| E | Custom domain and email alerts | 30 min |
| F | Take payments (Lemon Squeezy) | 45 min |
| G | Backups and safety | 10 min |
| H | Get your first 10 customers | ongoing |
| I | Troubleshooting | reference |
| J | What to build next | reference |

---

## Part A: Run it on your computer

### A1. Install the tools (one time)
1. Go to **https://nodejs.org** → click the **LTS** download (version 22 or newer) → install with all default options.
2. Go to **https://git-scm.com/downloads** → download for your system → install with default options.
3. Open a terminal:
   - Windows: press **Start**, type `PowerShell`, press **Enter**.
   - Mac: press **Cmd + Space**, type `Terminal`, press **Enter**.
4. Check both tools are installed. Type each line and press Enter:
   ```bash
   node -v
   git --version
   ```
   `node -v` must show **v22.13** or higher.

### A2. Download the code
```bash
git clone https://github.com/usmanabbas45/MY-SAAS-APP.git
cd MY-SAAS-APP
git checkout claude/saas-market-research-tt8mkn
npm install
```

### A3. Create your settings file
1. Copy the example file:
   - Windows: `copy .env.example .env`
   - Mac/Linux: `cp .env.example .env`
2. Open `.env` in Notepad or VS Code.
3. Set `APP_SECRET` to a long random string. To generate one, run:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copy the output and paste it after `APP_SECRET=`.
4. Do the same for `CRON_SECRET`, using a different random string.
5. For local testing only, set `ALLOW_PRIVATE_URLS=true` so you can test bots running on your own computer.
6. Save the file.

### A4. Start it
```bash
npm run dev
```
Open **http://localhost:3000** in your browser.

### A5. Try every feature with the sample data
1. Click **Start free** → fill in the form → **Create account**.
2. Left menu → **Chatbot audits**.
3. Under **1. Knowledge base**, click **Choose files** → select `examples/kb-shipping.txt` and `examples/kb-refunds.md` → **Add to knowledge base**.
4. Under **2. New audit**, choose `examples/sample-chats.csv` → **Start audit**.
5. Look at the **Fix list**: it points to the shipping article, because the bot invented a 49-dollar price.
6. Click **👍 Yes** on about 20 answers (include some from the **Correct** tab), then go to **Settings & AI model** → **Train model**. This trains your neural network.
7. Open **Setup guide** in the left menu to try the other modules.

### A6. Check that everything works
```bash
npm test            # expect: 42 passed
npm run typecheck   # expect: no output (no errors)
npm run build       # expect: "Compiled successfully"
```

---

## Part B: Turn on the AI judge

Without a key, ProofMyAI uses rules plus your neural network. With a key, Claude reads every answer like a human quality checker.

1. Go to **https://console.anthropic.com** → sign up.
2. Click **Settings → Billing** → add credits. $10 is plenty to start.
3. Click **API Keys → Create Key** → name it `proofmyai` → **copy** the key. You will only see it once.
4. Paste it into `.env` after `ANTHROPIC_API_KEY=`.
5. Stop the app (**Ctrl + C**) and start it again with `npm run dev`. The yellow "basic mode" banner disappears.

### Free option: Google Gemini
1. Go to **https://aistudio.google.com/apikey** → sign in with Google → **Create API key** → copy it.
2. Add it as `GEMINI_API_KEY=<key>` (in `.env` locally, or in Railway → **Variables**).
3. Leave `ANTHROPIC_API_KEY` empty, or set `JUDGE_PROVIDER=gemini` to force Gemini when both keys are set.
4. The dashboard now shows **"Gemini judge"**. The default model is `gemini-flash-lite-latest`, which has the largest free daily quota (roughly one request per conversation). If you see "usage limit reached", wait, use a smaller file, or turn on billing in Google AI Studio.

> ⚠️ On Gemini's **free** tier, Google may use the data you send to improve its products. That is fine for demos and your own test data. **Before auditing paying customers' chats, switch to a paid key** (Gemini with billing enabled, or Claude).

**Cost:** the judge uses `claude-opus-5` by default. The knowledge base is cached across every conversation in an audit, which cuts cost a lot. To reduce cost further, set `JUDGE_MODEL=claude-sonnet-5` in `.env`. Check the real cost in the Anthropic console after your first audits, then set your prices so each customer pays well above what their audits cost you.

---

## Part C: Put it online (Railway)

Railway is the easiest option: about $5/month, works worldwide, and uses the included `Dockerfile` automatically.

### C1. Put your code on GitHub
Your code is already in `github.com/usmanabbas45/MY-SAAS-APP` on the branch `claude/saas-market-research-tt8mkn`. On GitHub, open a pull request and merge it into `main`.

### C2. Create the Railway service
1. Go to **https://railway.app** → **Login with GitHub**.
2. Click **New Project → Deploy from GitHub repo** → pick **MY-SAAS-APP** → **Deploy Now**.
3. Click the new service → **Variables** tab → **Raw Editor** → paste the following, then fill in the values:
   ```
   APP_SECRET=<long random string>
   CRON_SECRET=<another long random string>
   ANTHROPIC_API_KEY=<your key>
   DATABASE_PATH=/data/agentproof.db
   APP_URL=https://<your-app>.up.railway.app
   NODE_ENV=production
   ```
   → **Update Variables**.
4. Right-click the service → **Attach Volume** → mount path **`/data`**. This keeps your database when the app restarts. **Do not skip this step.**
5. Service → **Settings → Networking → Generate Domain**. Copy the address and put it in `APP_URL` (step 3).
6. Wait for the green **Active** label, then open the domain. You should see the landing page.

**Alternative: your own server (Hetzner or DigitalOcean, about $5/month).** Create an Ubuntu server, install Docker, then:
```bash
git clone https://github.com/usmanabbas45/MY-SAAS-APP.git && cd MY-SAAS-APP
cp .env.example .env && nano .env      # fill in the values
docker compose up -d
```
Put **Caddy** or **Cloudflare** in front for HTTPS.

> ⚠️ Do not use Vercel or Netlify serverless hosting for this app. It stores data in a SQLite file, which needs a server with a persistent disk.

---

## Part D: Turn on automatic checks (every 15 minutes)

These checks power n8n/Make polling, stopped-workflow alerts and the nightly chatbot tests.

1. Go to **https://cron-job.org** → create a free account.
2. Click **Create cronjob**.
3. **URL:** `https://<your-domain>/api/cron?secret=<your CRON_SECRET>`
4. **Schedule:** every 15 minutes → **Create**.
5. Click **Test run**. You should see `{"ok":true,…}`.

---

## Part E: Custom domain and email alerts

### E1. Domain
1. Buy a domain on **Namecheap** or **Porkbun** (yours: `proofmyai.com`).
2. Railway → service → **Settings → Networking → Custom Domain** → type your domain.
3. Railway shows a **CNAME** record. At your domain registrar, open **DNS** → **Add record** → type CNAME, host `@` (or `www`), value as shown.
4. Wait 5–30 minutes. Then update `APP_URL` in Railway variables to `https://yourdomain.com`.

### E2. Email alerts (Resend)
1. Go to **https://resend.com** → sign up → **Domains → Add domain** → add the DNS records it shows → **Verify**.
2. **API Keys → Create** → copy the key.
3. Add these to your Railway variables:
   ```
   RESEND_API_KEY=<key>
   ALERT_FROM_EMAIL=alerts@yourdomain.com
   ```
4. In the app, go to **Settings** → set **Alert email** → **Save** → **Send test alert**.

---

## Part F: Take payments (Lemon Squeezy)

Lemon Squeezy acts as your "merchant of record": it handles cards and global sales tax, and pays out to Payoneer or a bank account, which works from Pakistan.

> Status: the pricing page is ready, but automatic billing and plan limits are **not built into the app yet** (see Part J). Start with the manual process below. It works fine for your first 20–50 customers.

1. Go to **https://lemonsqueezy.com** → sign up → complete **Store setup** and **Payouts** (Payoneer or bank).
2. **Products → New product** → create **Starter $29/month**, **Growth $79/month** and **Agency $199/month** as *subscriptions*.
3. Copy each product's **Share / checkout link**.
4. In `src/app/page.tsx`, change each plan's **Start free** button link to the matching checkout link. Keep one free-trial button linking to `/signup`.
5. When someone pays, you get an email. Reply with a welcome message and the setup-guide link.
6. **Later:** add a Lemon Squeezy webhook that saves the customer's plan in the database and enforces the limits automatically.

---

## Part G: Backups and safety

- **Backups:** everything is in one file, `/data/agentproof.db`. Turn on Railway's volume backups (service → Volume → **Backups**), or on your own server, copy the file daily with `sqlite3 /data/agentproof.db ".backup /backups/agentproof-$(date +%F).db"`.
- **Secrets:** never commit `.env`. Credentials customers enter (n8n/Make keys, bot headers) are encrypted with `APP_SECRET`. **If you change `APP_SECRET`, saved connections stop working** and customers must re-enter them.
- **Built-in security:** scrypt password hashing, httpOnly session cookies, AES-256-GCM encryption for stored credentials, SSRF protection (blocks private network addresses), login and API rate limiting, and per-user access checks on every page and action (tested).

---

## Part H: Get your first 10 customers

Follow the validation plan in `docs/market-research.md`. In short:

1. **Make a demo:** run an audit on a public chatbot (ask it 30 questions yourself, save the transcript) and screenshot the fix list.
2. **Offer free audits:** message 40 people:
   - Shopify stores that show a Tidio or Intercom chat bubble.
   - Chatbot and automation agencies on **Upwork, Fiverr and LinkedIn** (search "AI chatbot agency", "n8n expert", "Make.com expert").
   - Posts in r/shopify, r/n8n, r/automation and r/SaaS.

   > Hi {name}, I built a tool that checks AI chatbots for wrong answers and n8n/Make workflows for silent failures. I'd like to run a **free audit** of your bot. You'd get a report of every wrong answer and which help article causes it. Interested?
3. **Deliver the audit** in ProofMyAI and send screenshots of the fix list.
4. **Convert:** "Want this checked automatically every night? It's $29/month, and 50% off for life if you join as a founding customer."
5. **Agencies are the best channel:** one agency brings 10–50 client bots. Offer them the **Agency plan** and white-label reports.
6. **Your own freelancing:** add *"AI quality audits for chatbots and n8n/Make workflows"* as a service on Upwork and Fiverr, and use ProofMyAI to deliver it.

**Goal:** 3 paying customers in the first 30 days. If you reach it, build billing (Part J). If not, go back to the interview questions in the research doc and adjust the offer.

---

## Part H2: Power features (click by click)

### Live tracking
1. Left menu → **📡 Live tracking**.
2. Copy the code for your language and add it right after your chatbot replies. No-code option: open **"No-code: Intercom, Zendesk, Crisp, Tidio via n8n or Make"** on the same page and follow the 3 steps.
3. Every new answer appears in the live feed within seconds: **green ✓** = working, **red ✕** = problem (and you get an alert).

### Your own rules
1. **💬 Chatbot audits** → **📏 Your rules**.
2. Choose **"Bot must never say"** (e.g. `lifetime warranty`, a competitor's name) or **"Always hand over to a human when the customer mentions"** (e.g. `chargeback`, `allergic`).
3. Type the word or phrase → **Add rule**. It applies to every new audit and every live answer.

### Client reports (for agencies)
1. **Settings** → **Report brand name** → type your agency name → **Save settings**.
2. Open any audit → **🔗 Share client report** → **Copy share link** → send it to your client. No login is needed to view it.
3. **📄 Client report / PDF** → **🖨️ Save as PDF**. Use **Stop sharing** to turn the link off.
4. **⬇ CSV** downloads every answer and verdict for Excel or Google Sheets.

### Privacy
Personal data (emails, phone numbers, card numbers, IBANs, IP addresses) is masked automatically **before** it is stored or sent to the AI judge. You can change this in **Settings → Privacy & reports** (keep it on for real customer data).

### Weekly summary email
With an **Alert email** set and email sending configured (Part E2), a summary arrives once a week. Turn it off in **Settings → Privacy & reports**.

## Part I: Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails | Check `node -v` is 22.13 or newer. Delete `node_modules` and run `npm install` again. |
| Yellow "basic mode" banner | `ANTHROPIC_API_KEY` is missing. Add it and restart. |
| Audit status **failed** | Read the error on the audit page. Common causes: invalid API key, API credits used up, or knowledge base too large (over 600k characters; remove old articles). |
| "CSV needs columns…" | Rename your columns to `conversation_id, role, message`. Roles must be customer/user or bot/assistant. |
| n8n "Access denied" | Create a new n8n API key. On self-hosted n8n, make sure the public API is enabled and reachable from the internet. |
| Make connection errors | Use the correct zone (eu1/eu2/us1/us2, visible in your Make URL) and a token with `scenarios:read` scope. |
| "URL points to a private network address" | Bots and n8n must be reachable on the public internet. For local testing, set `ALLOW_PRIVATE_URLS=true`. |
| No alerts arriving | Settings → check the webhook/email → **Send test alert**. Email alerts need `RESEND_API_KEY`. |
| Nightly tests / polling not running | Check the cron-job.org job (Part D) and that the secret matches `CRON_SECRET`. |
| Data disappeared after a redeploy | The Railway volume is not mounted at `/data`, or `DATABASE_PATH` is wrong (Part C, steps 3–4). |

---

## Part J: What to build next (in order)

1. **Billing and plan limits:** Lemon Squeezy webhook → store the plan → enforce conversations/projects per month.
2. **Live chatbot monitoring:** an endpoint where bots send each conversation as it happens, so audits run continuously.
3. **Direct imports:** Intercom, Zendesk and Crisp APIs instead of CSV export.
4. **Team members:** invite colleagues and clients to a project.
5. **White-label PDF reports** for the Agency plan.
6. **Scale-up:** switch SQLite to Postgres once you have hundreds of customers (the database layer is isolated in `src/lib/db.ts`).
7. **Fine-tuning:** once you have thousands of reviewed answers (Settings → **Export training data**), fine-tune a model on that data to make the judge cheaper and more accurate for each industry.
