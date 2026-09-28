import Link from "next/link";
import { PublicPage } from "@/components/site";
import { LEGAL_COUNTRY, LEGAL_NAME, OPERATOR } from "@/lib/legal";
import { SUPPORT_EMAIL } from "@/lib/seo";

export const metadata = {
  title: "About ProofMyAI",
  description: "Who builds ProofMyAI and why: independent quality monitoring for AI chatbots, AI agents and n8n/Make automations.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <PublicPage title="About ProofMyAI">
      <p>ProofMyAI is built by <strong>{LEGAL_NAME}</strong>, an independent developer in {LEGAL_COUNTRY} who builds AI chatbots and n8n automations for businesses.</p>
      <h2>Why it exists</h2>
      <p>Businesses now let AI talk to their customers and run their operations, but almost nobody checks what it actually says and does. Chatbots make up prices and policies, agents loop and burn money, and automations report &quot;success&quot; while doing nothing. The business usually finds out from an angry customer. ProofMyAI is the independent check that catches these problems first and shows exactly what to fix.</p>
      <h2>How we work</h2>
      <ul>
        <li><strong>Privacy first:</strong> personal data is masked by default, and every project controls retention, results-only storage and whether an AI provider is used. See the <Link href="/security">Trust Center</Link>.</li>
        <li><strong>Honest numbers:</strong> examples on our website are labelled as illustrative. Your own audit shows your real results.</li>
        <li><strong>No lock-in:</strong> export your results any time and delete everything with one click.</li>
        <li><strong>Transparency with clients:</strong> agencies and freelancers who recommend ProofMyAI to their own clients should tell them if they have a business relationship with it. We do the same.</li>
      </ul>
      <h2>Company details</h2>
      <p>Operator: {OPERATOR}. Payments are handled by Paddle.com, our Merchant of Record. Email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. You can also use the <Link href="/contact">contact form</Link>.</p>
    </PublicPage>
  );
}
