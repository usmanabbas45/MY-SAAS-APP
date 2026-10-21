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
    <PublicPage title="Trust Center" updated="21 October 2026">
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
        <li><strong>CRM and Google Sheets monitoring is read-only:</strong> ProofMyAI never writes to your CRM or sheet. From CRM records it keeps only one-way hashes of emails and phone numbers (to spot duplicates), filled/empty flags and timestamps, never names, emails or phone numbers, and deletes them after 180 days.</li>
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
      <p className="sub">Our public website also uses Google Analytics (visits only, never inside the dashboard) and YouTube for videos (loaded only when you press play). We give at least 30 days&apos; notice by email before adding a sub-processor that handles customer data.</p>

      <h2>🔒 Security measures</h2>
      <ul>
        <li>HTTPS for every connection; security certificates managed by our host.</li>
        <li>Passwords hashed with scrypt; login sessions stored only as hashes in secure, http-only cookies; sign out of all devices at any time.</li>
        <li>Integration secrets (n8n/Make keys, CRM, Intercom and Twilio tokens, bot headers) encrypted with AES-256-GCM.</li>
        <li>Every page and API call checks that the data belongs to the requesting account; API keys are per project and can be replaced instantly.</li>
        <li>Protection against requests to private networks (SSRF) for every outbound call, and rate limits on logins and the API.</li>
        <li>Administrator access is limited to the operator and every admin action is logged. Support staff never see API keys, and we only open a customer&apos;s conversations to help that customer, at their request.</li>
        <li>Personal data breaches are reported to affected customers without undue delay, and at most within 72 hours of us becoming aware.</li>
      </ul>

      <h2>🧪 Security &amp; resilience, tested on every release</h2>
      <p>These behaviours are checked by automated tests that must pass before any change goes live (360+ tests in total). They show the protections work as designed; they are not an external penetration test or certification.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Area</th><th>What the tests prove</th></tr></thead>
          <tbody>
            <tr><td>Tenant isolation</td><td>A login or API key can never open, read or write another customer&apos;s project, approvals or traces; data sent with a key lands only in that key&apos;s project.</td></tr>
            <tr><td>Outbound requests (SSRF)</td><td>Private, loopback, cloud-metadata and reserved addresses are blocked in every notation, before and while connecting, including DNS-rebinding tricks.</td></tr>
            <tr><td>Credentials</td><td>Integration secrets are encrypted and tampering is detected; passwords are hashed; password resets are single-use and expire; resetting signs out every device.</td></tr>
            <tr><td>Login protection</td><td>Two-factor codes match the RFC 6238 standard and work once; CAPTCHA can&apos;t be replayed; breached and weak passwords are refused; disposable emails are blocked; rate limits apply.</td></tr>
            <tr><td>Approvals (retry safety)</td><td>Duplicate and simultaneous requests become one; rejected actions stay blocked on every retry; only the first of two simultaneous decisions counts; expired requests can&apos;t be approved; a failed callback never loses the decision.</td></tr>
            <tr><td>Webhooks</td><td>WhatsApp webhooks need the project key; phone numbers are never used as conversation ids.</td></tr>
            <tr><td>Privacy</td><td>Personal data masking (cards, emails, phones, postcodes, plates, names, custom words), results-only mode, AI-off mode and retention deletion.</td></tr>
            <tr><td>Recovery</td><td>Every daily backup is restored into a scratch database and checked (integrity, row counts, encryption round-trip); the restore script recovers the data; a damaged backup fails the check. Result shown on the <a href="/status">status page</a>.</td></tr>
            <tr><td>Detection quality</td><td>A regression guard keeps basic-mode accuracy on the <a href="/benchmark">public benchmark</a> from getting worse.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>🛡️ Your AI integration stays safe</h2>
      <p>Our code snippets send data in the background with a 2-second limit, so monitoring can never slow down or break your chatbot or agent. Nightly tests should point at a test endpoint, never at a live WhatsApp/Twilio or SMS webhook.</p>

      <h2>🏗️ Self-hosted and enterprise</h2>
      <p>For dealerships, finance, healthcare and other regulated businesses, ProofMyAI can run <strong>on your own server or cloud account</strong>, so conversations never leave your infrastructure, with an AI provider of your choice or none. <a href={`mailto:${SUPPORT_EMAIL}?subject=Self-hosted%20ProofMyAI`}>Ask about self-hosting</a>.</p>

      <h2>📄 Questions and documents</h2>
      <p>Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> for a signed DPA, a security questionnaire, or anything not answered here. See also our <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms</Link>.</p>
    </PublicPage>
  );
}
