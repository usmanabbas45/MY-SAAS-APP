import Link from "next/link";
import { PublicPage } from "@/components/site";
import { aiTrainingStatement, HOSTING_REGION, OPERATOR } from "@/lib/legal";
import { SUPPORT_EMAIL } from "@/lib/seo";

export const metadata = { title: "Privacy Policy", description: "How ProofMyAI collects, uses and protects your data.", alternates: { canonical: "/privacy" } };
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <PublicPage title="Privacy Policy" updated="28 September 2026">
      <p>This policy explains what data ProofMyAI collects, why, and your choices. ProofMyAI is operated by <strong>{OPERATOR}</strong>. Contact us at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with any privacy question.</p>
      <p>For the conversations and other content you send us about <em>your</em> customers, you are the data controller and we are your processor under our <Link href="/dpa">Data Processing Agreement</Link>. Full details are in the <Link href="/security">Trust Center</Link>.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your email address and a securely hashed password (we never store the password itself).</li>
        <li><strong>Content you provide:</strong> chat transcripts, knowledge base articles, test questions, AI agent runs and workflow execution data you upload or send.</li>
        <li><strong>Connection details:</strong> API keys and webhook URLs for n8n, Make, bots and alert channels, stored encrypted.</li>
        <li><strong>Technical data:</strong> basic server logs (such as IP address and time of request) to keep the Service secure.</li>
      </ul>
      <h2>Personal data masking</h2>
      <p>By default, emails, phone numbers, card numbers, IBANs, IP addresses, UK postcodes, UK number plates and self-introduced names inside transcripts and agent runs are masked <strong>before</strong> they are stored or sent to an AI model. Each project can add its own words to mask, keep results only (no conversation text), switch the AI provider off, and delete data automatically after 7 to 365 days (Settings → Data &amp; privacy).</p>
      <h2>How we use data</h2>
      <p>Only to provide the Service: grading answers, running checks, sending alerts and reports you set up, account emails (such as password resets) and security. We do not sell your data and do not use it for advertising.</p>
      <h2>Service providers</h2>
      <ul>
        <li><strong>Hosting:</strong> Railway (application and database){HOSTING_REGION ? `, ${HOSTING_REGION}` : ""}.</li>
        <li><strong>AI checking:</strong> Anthropic (Claude) or Google (Gemini), only for projects with AI checking on. Only the masked content needed for a check is sent. {aiTrainingStatement()}</li>
        <li><strong>Email:</strong> Resend, for alerts, summaries and password resets.</li>
        <li><strong>Payments:</strong> Paddle.com is our online reseller and Merchant of Record. Paddle collects and processes your billing details; we never see your full card number.</li>
      </ul>
      <h2>Cookies</h2>
      <p>We use one essential cookie to keep you logged in, and your browser&apos;s local storage to remember your light/dark theme. We do not use advertising cookies.{process.env.GA_MEASUREMENT_ID ? " On our public pages (not inside the dashboard) we use Google Analytics to count visits and see which pages are useful; it sets analytics cookies and IP addresses are anonymised. You can block it with any ad blocker or browser privacy setting. When you sign up, send the contact form, start a trial or pay, our server tells Google Analytics that this happened (with the analytics ID from that cookie, the plan and price, never your name, email or any content) so we can see which marketing works." : null} Our videos are hosted on YouTube and only load (from youtube-nocookie.com) after you click play.</p>
      <h2>Retention and deletion</h2>
      <p>Your data is kept while your account exists, or for the shorter period you set per project. You can delete individual audits and projects at any time, or delete your whole account in <strong>Account → Delete account</strong>, which permanently removes all your data. Backups are overwritten within 30 days.</p>
      <h2>Your rights</h2>
      <p>You can access, export (CSV and JSONL exports in the app), correct or delete your data. Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> for any other request and we will reply within 30 days.</p>
      <h2>Security</h2>
      <p>Passwords are hashed with scrypt, credentials are encrypted with AES-256-GCM, connections use HTTPS, and every page checks that you own the data you view.</p>
      <h2>Changes</h2>
      <p>If we change this policy we will update the date above and, for important changes, email account owners. See also our <Link href="/terms">Terms of Service</Link>.</p>
    </PublicPage>
  );
}
