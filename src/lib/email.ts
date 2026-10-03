import { SUPPORT_EMAIL } from "./seo";

export interface Mail {
  subject: string;
  text: string;
  html?: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

/** "Name <address>" using the verified sending address (ALERT_FROM_EMAIL, default alerts@proofmyai.com). */
export function fromAddress(name = "ProofMyAI"): string {
  const configured = (process.env.ALERT_FROM_EMAIL || "alerts@proofmyai.com").trim();
  if (configured.includes("<")) return configured;
  return `${name} <${configured}>`;
}

/**
 * Sends an email through Resend (HTML with a plain-text fallback). Replies go to the support inbox unless
 * replyTo is given. Returns false when email is not configured; throws when Resend rejects the message.
 */
export async function sendMail(to: string, mail: Mail, opts: { replyTo?: string; fromName?: string; attachments?: { filename: string; content: Buffer }[] } = {}): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: fromAddress(opts.fromName),
      to: [to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      reply_to: opts.replyTo || SUPPORT_EMAIL,
      ...(mail.headers ? { headers: mail.headers } : {}),
      ...(opts.attachments?.length ? { attachments: opts.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) } : {}),
    }),
    signal: AbortSignal.timeout(opts.attachments?.length ? 120000 : 10000),
  });
  if (!res.ok) throw new Error(`Resend returned HTTP ${res.status}`);
  return true;
}

/** Plain-text email (kept for simple internal messages). */
export async function sendEmail(to: string, subject: string, text: string, replyTo?: string): Promise<boolean> {
  return sendMail(to, { subject, text }, { replyTo });
}
