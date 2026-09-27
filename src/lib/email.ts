/** Sends a plain-text email through Resend. Returns false when email is not configured. */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL || "alerts@proofmyai.com", to: [to], subject, text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Resend returned HTTP ${res.status}`);
  return true;
}
