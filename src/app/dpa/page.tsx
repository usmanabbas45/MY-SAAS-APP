import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { PublicPage } from "@/components/site";
import { Flash } from "@/components/ui";
import { currentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { OPERATOR } from "@/lib/legal";
import { SUPPORT_EMAIL } from "@/lib/seo";
import { acceptDpaAction } from "./actions";

export const metadata = {
  title: "Data Processing Agreement (DPA)",
  description: "ProofMyAI's GDPR / UK GDPR Article 28 Data Processing Agreement for customers, with sub-processors, security measures and international transfers.",
  alternates: { canonical: "/dpa" },
};
export const dynamic = "force-dynamic";

export default async function DpaPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await currentUser();
  const flash = await searchParams;
  const accepted = user ? get<{ at: string | null; company: string | null }>("SELECT dpa_accepted_at AS at, dpa_company AS company FROM users WHERE id = ?", user.id) : undefined;
  return (
    <PublicPage title="Data Processing Agreement" updated="28 September 2026">
      <p>This Data Processing Agreement (&quot;DPA&quot;) forms part of the <Link href="/terms">Terms of Service</Link> between the customer (&quot;Controller&quot;) and <strong>{OPERATOR}</strong>, operating ProofMyAI (&quot;Processor&quot;). It applies whenever ProofMyAI processes personal data on the Customer&apos;s behalf and meets the requirements of Article 28 of the EU GDPR and the UK GDPR.</p>

      <h2>1. Subject matter, nature and purpose</h2>
      <p>The Processor provides quality monitoring of the Controller&apos;s AI chatbots, AI agents and automation workflows: storing, masking, analysing and reporting on the data the Controller uploads or sends, and sending the alerts and reports the Controller configures. The Processor processes personal data only for this purpose and for the duration of the agreement.</p>

      <h2>2. Types of data and data subjects</h2>
      <ul>
        <li><strong>Data subjects:</strong> the Controller&apos;s customers and website visitors who talk to its chatbots; the Controller&apos;s staff who use ProofMyAI.</li>
        <li><strong>Personal data:</strong> contents of chat conversations and AI agent runs as sent by the Controller (which may include names, contact details, vehicle, order or account details and complaint text), metadata such as timestamps and conversation IDs, and the account details of the Controller&apos;s users.</li>
        <li><strong>Special category data:</strong> the Controller should not send it. If a conversation contains it, the Processor handles it under this DPA and the Controller should use masking, results-only mode and short retention.</li>
      </ul>

      <h2>3. Processor obligations</h2>
      <ul>
        <li>Process personal data only on the Controller&apos;s documented instructions, which are the Terms, this DPA and the Controller&apos;s settings in ProofMyAI, and tell the Controller if an instruction appears to break data protection law.</li>
        <li>Ensure anyone with access is bound by confidentiality.</li>
        <li>Apply the technical and organisational measures described in the <Link href="/security">Trust Center</Link>, including encryption in transit, encryption of stored credentials, hashed passwords, access control, masking and logging of administrative actions.</li>
        <li>Help the Controller respond to data subject requests (access, correction, deletion, export) and with data protection impact assessments, as far as reasonably possible.</li>
        <li>Notify the Controller of a personal data breach without undue delay and in any case within 72 hours of becoming aware of it, with the information needed to meet the Controller&apos;s own obligations.</li>
        <li>Make available the information needed to demonstrate compliance with this DPA and allow reasonable audits, normally through written answers and documentation, with at least 30 days&apos; notice and at the Controller&apos;s cost.</li>
      </ul>

      <h2>4. Sub-processors</h2>
      <p>The Controller authorises the sub-processors listed in the <Link href="/security">Trust Center</Link>. The Processor imposes data protection terms on each that are no less protective than this DPA, remains responsible for them, and gives at least 30 days&apos; notice by email before adding or replacing a sub-processor that handles customer data. The Controller may object on reasonable grounds and, if no solution is found, end the service with a pro-rata refund of prepaid fees.</p>

      <h2>5. International transfers</h2>
      <p>Where personal data is transferred outside the UK or EEA to a country without an adequacy decision, including to the Processor&apos;s own location, the parties rely on the EU Standard Contractual Clauses (Module 2, controller to processor, or Module 3 for sub-processors) and the UK International Data Transfer Addendum, which are incorporated into this DPA by reference.</p>

      <h2>6. Controller responsibilities</h2>
      <p>The Controller is responsible for having a lawful basis for the processing, for informing its customers (for example in its privacy notice) that conversations are quality-checked by a service provider, and for choosing appropriate settings (masking, retention, results-only mode and whether AI checking is used).</p>

      <h2>7. Deletion and return</h2>
      <p>The Controller can delete data at any time in the dashboard, set automatic deletion per project, and export results as CSV. When the account is deleted, personal data is deleted from the live database immediately and from backups within 30 days, unless the law requires otherwise.</p>

      <h2>8. Liability and order of precedence</h2>
      <p>Liability under this DPA is subject to the limits in the Terms, except where the law does not allow limitation. If this DPA conflicts with the Terms, this DPA prevails for the processing of personal data.</p>

      <div className="card" id="accept" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Accept this DPA</h2>
        <Flash {...flash} />
        {!user ? (
          <p><Link href="/login">Log in</Link> to accept this DPA online for your account, or email <a href={`mailto:${SUPPORT_EMAIL}?subject=DPA%20for%20signature`}>{SUPPORT_EMAIL}</a> for a copy signed by both parties.</p>
        ) : accepted?.at ? (
          <p>✅ Accepted for <strong>{accepted.company}</strong> by {user.email} on {accepted.at.slice(0, 10)}. Save this page as a PDF (Ctrl + P) for your records, or email us for a countersigned copy.</p>
        ) : (
          <form action={acceptDpaAction}>
            <div className="field"><label htmlFor="company">Company (data controller) legal name</label><input id="company" name="company" type="text" maxLength={200} placeholder="AB Dealers Ltd" /></div>
            <label className="check"><input type="checkbox" name="agree" /> I am authorised to accept this Data Processing Agreement on behalf of this company.</label>
            <div style={{ marginTop: 12 }}><SubmitButton pendingText="Saving…">Accept DPA</SubmitButton></div>
          </form>
        )}
      </div>
    </PublicPage>
  );
}
