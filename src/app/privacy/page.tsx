import Link from "next/link";
import { PublicPage } from "@/components/site";
import { SUPPORT_EMAIL } from "@/lib/seo";

export const metadata = { title: "Privacy Policy", description: "How ProofMyAI collects, uses and protects your data.", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return (
    <PublicPage title="Privacy Policy" updated="27 September 2026">
      <p>This policy explains what data ProofMyAI collects, why, and your choices. Contact us at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with any privacy question.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your email address and a securely hashed password (we never store the password itself).</li>
        <li><strong>Content you provide:</strong> chat transcripts, knowledge base articles, test questions, AI agent runs and workflow execution data you upload or send.</li>
        <li><strong>Connection details:</strong> API keys and webhook URLs for n8n, Make, bots and alert channels, stored encrypted.</li>
        <li><strong>Technical data:</strong> basic server logs (such as IP address and time of request) to keep the Service secure.</li>
      </ul>
      <h2>Personal data masking</h2>
      <p>By default, emails, phone numbers, card numbers, IBANs and IP addresses inside transcripts are masked <strong>before</strong> they are stored or sent to an AI model. You can change this per project in Settings.</p>
      <h2>How we use data</h2>
      <p>Only to provide the Service: grading answers, running checks, sending alerts and reports you set up, account emails (such as password resets) and security. We do not sell your data and do not use it for advertising.</p>
      <h2>Service providers</h2>
      <ul>
        <li><strong>Hosting:</strong> Railway (application and database).</li>
        <li><strong>AI checking:</strong> Anthropic (Claude) or Google (Gemini), when the AI judge is enabled. Only the content needed for a check is sent.</li>
        <li><strong>Email:</strong> Resend, for alerts, summaries and password resets.</li>
      </ul>
      <h2>Cookies</h2>
      <p>We use one essential cookie to keep you logged in, and your browser&apos;s local storage to remember your light/dark theme. We do not use advertising or tracking cookies.</p>
      <h2>Retention and deletion</h2>
      <p>Your data is kept while your account exists. You can delete individual audits and projects at any time, or delete your whole account in <strong>Account → Delete account</strong>, which permanently removes all your data. Backups are overwritten within 30 days.</p>
      <h2>Your rights</h2>
      <p>You can access, export (CSV and JSONL exports in the app), correct or delete your data. Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> for any other request and we will reply within 30 days.</p>
      <h2>Security</h2>
      <p>Passwords are hashed with scrypt, credentials are encrypted with AES-256-GCM, connections use HTTPS, and every page checks that you own the data you view.</p>
      <h2>Changes</h2>
      <p>If we change this policy we will update the date above and, for important changes, email account owners. See also our <Link href="/terms">Terms of Service</Link>.</p>
    </PublicPage>
  );
}
