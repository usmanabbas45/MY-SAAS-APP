import Link from "next/link";
import { PublicPage } from "@/components/site";
import { SUPPORT_EMAIL } from "@/lib/seo";
import { CATEGORIES, DEVELOPER_NAME, DEVELOPER_URL, WHATSAPP_DISPLAY, whatsappLink } from "@/lib/support";
import { submitTicketAction } from "./actions";
import { TicketForm } from "./TicketForm";

export const metadata = {
  title: "Support: report an issue or chat with us",
  description: "Get help with ProofMyAI: submit a support ticket, chat on WhatsApp, email us, or hire the developer for custom AI chatbot, agent and n8n work.",
  alternates: { canonical: "/support" },
};

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  return (
    <PublicPage title="Support">
      <p>Something not working, a question, or need help connecting your chatbot? Pick whatever is easiest for you.</p>
      <div className="grid grid-3 support-options">
        <a className="card support-card" href={whatsappLink()} target="_blank" rel="noopener">
          <span className="support-icon">💬</span>
          <strong>WhatsApp</strong>
          <span className="sub">{WHATSAPP_DISPLAY}<br />Fastest for urgent issues</span>
        </a>
        <a className="card support-card" href="#ticket">
          <span className="support-icon">🎫</span>
          <strong>Submit a ticket</strong>
          <span className="sub">Report an error or issue.<br />Reply by email within 1 business day</span>
        </a>
        <a className="card support-card" href={`mailto:${SUPPORT_EMAIL}`}>
          <span className="support-icon">✉️</span>
          <strong>Email</strong>
          <span className="sub">{SUPPORT_EMAIL}</span>
        </a>
      </div>

      <h2>Report an issue</h2>
      <p className="sub">Already a customer? <Link href="/app/support">Log in to submit and track tickets</Link> from your dashboard.</p>
      <TicketForm action={submitTicketAction} categories={CATEGORIES} defaultCategory={topic && topic in CATEGORIES ? topic : undefined} />

      <div className="card dev-card">
        <div>
          <h2 style={{ marginTop: 0 }}>👨‍💻 Need a developer?</h2>
          <p style={{ margin: 0 }}>ProofMyAI is built by an AI automation developer. If you need a custom AI chatbot, an AI agent, n8n or Make automations, or help fixing what ProofMyAI found, hire me directly.</p>
        </div>
        <div className="row">
          <a className="btn" href={DEVELOPER_URL} target="_blank" rel="noopener">Visit {DEVELOPER_NAME} ↗</a>
          <a className="btn btn-whatsapp" href={whatsappLink("Hi! I'd like to hire you for a development project.")} target="_blank" rel="noopener">💬 WhatsApp</a>
        </div>
      </div>

      <h2>Quick answers</h2>
      <ul>
        <li><strong>Setup help:</strong> every step is in your dashboard under <strong>Setup guide</strong>, and there&apos;s a <Link href="/#video">3-minute video</Link>.</li>
        <li><strong>Billing, cancel or auto-renew:</strong> Dashboard → <strong>Plan &amp; billing</strong>. See also our <Link href="/refund">Refund Policy</Link>.</li>
        <li><strong>Forgot password:</strong> <Link href="/forgot-password">reset it here</Link>.</li>
        <li><strong>Data &amp; privacy questions:</strong> see the <Link href="/security">Trust Center</Link>.</li>
      </ul>
    </PublicPage>
  );
}
