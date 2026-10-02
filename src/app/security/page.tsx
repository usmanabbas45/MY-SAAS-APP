import Link from "next/link";
import { PublicPage } from "@/components/site";
import { aiTrainingStatement, HOSTING_REGION, OPERATOR, subprocessors } from "@/lib/legal";
import { SUPPORT_EMAIL } from "@/lib/seo";

export const metadata = {
  title: "Trust Center: Security & Data Protection",
  description: "How ProofMyAI protects customer data: masking, retention controls, encryption, sub-processors, AI provider use, GDPR/UK GDPR and self-hosting.",
  alternates: { canonical: "/security" },
};
export const dynamic = "force-dynamic";

export default function SecurityPage() {
  const subs = subprocessors();
  return (
    <PublicPage title="Trust Center" updated="28 September 2026">
      <p>ProofMyAI processes conversations between businesses and their customers, so we built it to collect as little as possible and to give each business control over what is stored and where it goes. This page answers the questions a data protection review usually asks.</p>

      <h2>🏢 Who we are</h2>
      <p>ProofMyAI is operated by <strong>{OPERATOR}</strong>. <Link href="/about">About us</Link>. Contact: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      <p>For customer data you send us, <strong>you are the data controller and ProofMyAI is your data processor</strong>. Our <Link href="/dpa">Data Processing Agreement (DPA)</Link> sets this out under GDPR / UK GDPR Article 28 and can be accepted online.</p>

      <h2>🎛️ Controls you have, per project</h2>
      <ul>
        <li><strong>Masking before storage and AI checks</strong> (on by default): emails, phone numbers, card numbers, IBANs, IP addresses, UK postcodes, UK number plates, self-introduced names (&quot;my name is …&quot;), plus your own list of words (customer names, account numbers, internal codes).</li>
        <li><strong>Results-only mode:</strong> keep verdicts, reasons and scores but never the conversation text.</li>
        <li><strong>Automatic deletion</strong> after 7, 30, 90 or 365 days.</li>
        <li><strong>AI provider off:</strong> checks run with rules and your own neural model only, so no data leaves ProofMyAI.</li>
        <li><strong>Delete any time:</strong> audits, projects or your whole account, removed immediately from the live database.</li>
        <li><strong>Upload instead of connect:</strong> audits can run on exported, anonymised files with no live connection to your systems.</li>
      </ul>
      <p className="sub">Masking is pattern-based. It greatly reduces personal data, but it cannot guarantee that every free-text detail is caught. For highly sensitive data, combine it with results-only mode, short retention, AI off, or self-hosting.</p>

      <h2>🌍 Where data is processed</h2>
      <ul>
        <li><strong>Application and database:</strong> Railway{HOSTING_REGION ? `, ${HOSTING_REGION}` : " (region available on request)"}.</li>
        <li><strong>AI judge (only when on for a project):</strong> masked text is sent to the AI provider listed below, only for the check, over HTTPS. {aiTrainingStatement()}</li>
        <li>Transfers outside the UK/EEA are covered by the safeguards in our <Link href="/dpa">DPA</Link> (EU Standard Contractual Clauses and the UK Addendum).</li>
      </ul>

      <h2>🤝 Sub-processors</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Company</th><th>Purpose</th><th>Data</th><th>Location</th><th>In use</th></tr></thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.name}><td>{s.name}</td><td>{s.purpose}</td><td>{s.data}</td><td>{s.location}</td><td>{s.active ? "Yes" : "No"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub">Our public website counts visits on our own server without cookies (no Google Analytics, never inside the dashboard) and uses YouTube for videos (loaded only when you press play). We give at least 30 days&apos; notice by email before adding a sub-processor that handles customer data.</p>

      <h2>🔒 Security measures</h2>
      <ul>
        <li>HTTPS for every connection; security certificates managed by our host.</li>
        <li>Passwords hashed with scrypt; login sessions stored only as hashes in secure, http-only cookies; sign out of all devices at any time.</li>
        <li>Integration secrets (n8n/Make keys, bot headers) encrypted with AES-256-GCM.</li>
        <li>Every page and API call checks that the data belongs to the requesting account; API keys are per project and can be replaced instantly.</li>
        <li>Protection against requests to private networks (SSRF) for every outbound call, and rate limits on logins and the API.</li>
        <li>Administrator access is limited to the operator and every admin action is logged. Support staff never see API keys, and we only open a customer&apos;s conversations to help that customer, at their request.</li>
        <li>Personal data breaches are reported to affected customers without undue delay, and at most within 72 hours of us becoming aware.</li>
      </ul>

      <h2>🛡️ Your AI integration stays safe</h2>
      <p>Our code snippets send data in the background with a 2-second limit, so monitoring can never slow down or break your chatbot or agent. Nightly tests should point at a test endpoint, never at a live WhatsApp/Twilio or SMS webhook.</p>

      <h2>🏗️ Self-hosted and enterprise</h2>
      <p>For dealerships, finance, healthcare and other regulated businesses, ProofMyAI can run <strong>on your own server or cloud account</strong>, so conversations never leave your infrastructure, with an AI provider of your choice or none. <a href={`mailto:${SUPPORT_EMAIL}?subject=Self-hosted%20ProofMyAI`}>Ask about self-hosting</a>.</p>

      <h2>📄 Questions and documents</h2>
      <p>Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> for a signed DPA, a security questionnaire, or anything not answered here. See also our <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms</Link>.</p>
    </PublicPage>
  );
}
