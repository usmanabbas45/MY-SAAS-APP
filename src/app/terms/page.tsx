import Link from "next/link";
import { PublicPage } from "@/components/site";
import { SUPPORT_EMAIL } from "@/lib/seo";

export const metadata = { title: "Terms of Service", description: "The terms for using ProofMyAI.", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return (
    <PublicPage title="Terms of Service" updated="27 September 2026">
      <p>These terms apply when you use ProofMyAI (the &quot;Service&quot;) at proofmyai.com. By creating an account you agree to them. If you use the Service for a company, you confirm you may accept these terms for it.</p>
      <h2>1. The Service</h2>
      <p>ProofMyAI checks the quality of AI chatbots, AI agents and automation workflows that you connect or upload, and shows results, alerts and reports. Results are produced by automated rules and AI models and <strong>can be wrong</strong>. They help you find problems; they are not a guarantee that your AI systems are correct, safe or legally compliant.</p>
      <h2>2. Your account</h2>
      <ul>
        <li>Give accurate information and keep your password and API keys secret.</li>
        <li>You are responsible for everything done with your account and API keys.</li>
        <li>Tell us straight away at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> if you think your account was misused.</li>
      </ul>
      <h2>3. Your data</h2>
      <p>You keep all rights to the content you upload or send (chat transcripts, knowledge base articles, agent and workflow data). You give us permission to store and process it only to provide the Service to you. You confirm you have the right to share this data with us, including any notices or consents your own customers need. How we handle data is described in our <Link href="/privacy">Privacy Policy</Link>.</p>
      <h2>4. Acceptable use</h2>
      <p>Do not use the Service to break the law, to upload content you have no right to use, to attack or overload the Service or other systems, to scan private networks, or to resell access without our written agreement.</p>
      <h2>5. Plans and payment</h2>
      <p>Paid plans are billed in advance each month through our payment provider. You can cancel at any time, and your plan stays active until the end of the paid period. Prices may change with at least 30 days&apos; notice. Unless the law requires otherwise, payments are not refundable.</p>
      <h2>6. Availability and changes</h2>
      <p>We work hard to keep the Service running, but it is provided &quot;as is&quot; without guarantees of uninterrupted availability. We may improve or change features over time.</p>
      <h2>7. Liability</h2>
      <p>To the extent the law allows, we are not liable for indirect or consequential losses (such as lost profits, revenue or data), and our total liability for any claim is limited to the amount you paid us in the 3 months before the claim.</p>
      <h2>8. Ending your account</h2>
      <p>You can delete your account at any time in <strong>Account → Delete account</strong>; this deletes your data. We may suspend accounts that break these terms.</p>
      <h2>9. Contact</h2>
      <p>Questions about these terms: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or our <Link href="/contact">contact page</Link>.</p>
    </PublicPage>
  );
}
