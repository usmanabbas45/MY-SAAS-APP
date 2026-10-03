import { all, get, run } from "./db";
import { sendMail, type Mail } from "./email";
import { compose } from "./emails";
import { SITE_URL } from "./seo";
import { welcomeUnsubHeaders, welcomeUnsubUrl } from "./unsubscribe";

/**
 * Getting-started emails for new accounts that haven't connected anything yet: day 1, day 3 and day 7
 * after sign-up. They stop as soon as the account connects a chatbot, agent or workflow, and are only
 * sent to confirmed email addresses. users.onboard_step = last email sent (0-3); 9 = finished.
 */
export const SCHEDULE_DAYS = [1, 3, 7] as const;
export const DONE = 9;

const appUrl = () => (process.env.APP_URL || SITE_URL).replace(/\/+$/, "");

/** True once any of the user's own (non-demo) projects has real data or a connection. */
export function isActivated(userId: number): boolean {
  const own = "SELECT id FROM projects WHERE user_id = ? AND is_demo = 0";
  return Boolean(get(
    `SELECT 1 FROM projects WHERE id IN (${own}) AND (
       EXISTS (SELECT 1 FROM audits a WHERE a.project_id = projects.id)
       OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.project_id = projects.id)
       OR EXISTS (SELECT 1 FROM workflow_runs w WHERE w.project_id = projects.id)
       OR EXISTS (SELECT 1 FROM workflow_sources s WHERE s.project_id = projects.id)
       OR EXISTS (SELECT 1 FROM chat_sources c WHERE c.project_id = projects.id)
       OR EXISTS (SELECT 1 FROM bot_targets b WHERE b.project_id = projects.id)
     ) LIMIT 1`, userId,
  ));
}

export function welcomeEmail(step: 1 | 2 | 3, userId: number, projectId: number | null): Mail {
  const base = projectId ? `${appUrl()}/app/p/${projectId}` : `${appUrl()}/app`;
  const footer = "You're receiving this because you created a ProofMyAI account. Three short emails, then they stop.";
  const unsub = { label: "Unsubscribe", url: welcomeUnsubUrl(userId) };
  let mail: Mail;
  if (step === 1) {
    mail = compose("Connect your chatbot in 2 minutes", "Pick what ProofMyAI should watch: a chatbot, an AI agent or your n8n/Make workflows.", {
      icon: "👋",
      title: "Let's check your first AI answers",
      paragraphs: [
        "Thanks for signing up to ProofMyAI! The fastest way to see value is to connect one thing. Pick whichever is easiest:",
      ],
      bullets: [
        "💬 A chatbot: upload a chat export, or connect Intercom, WhatsApp or your own bot (about 2 minutes)",
        "🤖 An AI agent: one line of code or an n8n/Make HTTP step sends each run",
        "⚙️ n8n or Make: paste your API key and every workflow failure is caught",
      ],
      cta: { label: "Connect in 2 minutes", url: `${base}/connect` },
      after: ["Not ready yet? Click “Try with demo data” on your dashboard to see a full example with real-looking results first.", "Stuck? Just reply to this email. I read every one."],
    }, footer, unsub);
  } else if (step === 2) {
    mail = compose("The mistakes AI chatbots make without anyone noticing", "Made-up discount codes, wrong refund promises, card numbers taken in chat…", {
      icon: "🔍",
      title: "Is your chatbot doing any of these?",
      paragraphs: [
        "These are the kinds of mistakes ProofMyAI catches in shop and support chatbots. The business usually has no idea until a customer complains:",
      ],
      bullets: [
        "Promised a full refund on sale items (the policy says store credit only)",
        "Invented a student discount code that doesn't exist",
        "Accepted a customer's card number in the chat",
        "Ignored an angry customer who asked for a human",
      ],
      after: ["Each of these is a refund, a complaint or a lost customer. ProofMyAI finds them automatically and ✨ Fix with AI writes the corrected help article for you.", "Your bot is probably making some of these mistakes right now. It takes 2 minutes to find out."],
      cta: { label: "Check my bot now", url: `${base}/connect` },
    }, footer, unsub);
  } else {
    mail = compose("Want me to set it up for you?", "Reply to this email and I'll connect ProofMyAI for you, free.", {
      icon: "🤝",
      title: "I can set it up for you, free",
      paragraphs: [
        "Hi, it's Muhammad, the founder of ProofMyAI.",
        "I noticed you haven't connected a chatbot, agent or workflow yet. That's usually because it isn't clear which option fits your setup, or there's no time this week.",
        "Just reply to this email and tell me what you use (for example “Tidio chatbot” or “n8n workflows”). I'll send you exact click-by-click steps, or set it up with you on a short call. No charge.",
      ],
      cta: { label: "Or connect it yourself", url: `${base}/connect` },
      after: ["This is the last getting-started email. After this you'll only get alerts and the emails you choose."],
    }, footer, unsub);
  }
  return { ...mail, headers: welcomeUnsubHeaders(userId) };
}

/** Sends every welcome email that's due. Called from the 15-minute cron. */
export async function sendDueOnboarding(now = new Date()): Promise<number> {
  if (!process.env.RESEND_API_KEY) return 0;
  const users = all<{ id: number; email: string; created_at: string; onboard_step: number }>(
    `SELECT id, email, created_at, onboard_step FROM users
      WHERE onboard_step < ? AND email_verified_at IS NOT NULL AND suspended_at IS NULL ORDER BY id`,
    SCHEDULE_DAYS.length,
  );
  let sent = 0;
  for (const u of users) {
    if (isActivated(u.id)) {
      run("UPDATE users SET onboard_step = ? WHERE id = ?", DONE, u.id);
      continue;
    }
    const next = (u.onboard_step + 1) as 1 | 2 | 3;
    const ageDays = (now.getTime() - Date.parse(`${u.created_at.replace(" ", "T")}${u.created_at.endsWith("Z") ? "" : "Z"}`)) / 86400000;
    if (ageDays < SCHEDULE_DAYS[next - 1]) continue;
    // Skip emails that are long overdue (e.g. an account confirmed late) instead of sending them back-to-back.
    const later = SCHEDULE_DAYS.findLastIndex((d) => ageDays >= d) + 1;
    const step = Math.max(next, later) as 1 | 2 | 3;
    const projectId = get<{ id: number }>("SELECT id FROM projects WHERE user_id = ? AND is_demo = 0 ORDER BY id LIMIT 1", u.id)?.id ?? null;
    try {
      await sendMail(u.email, welcomeEmail(step, u.id, projectId), { fromName: "Muhammad at ProofMyAI" });
      run("UPDATE users SET onboard_step = ? WHERE id = ?", step >= SCHEDULE_DAYS.length ? DONE : step, u.id);
      sent++;
    } catch (err) {
      console.error(`[onboarding] user ${u.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}
