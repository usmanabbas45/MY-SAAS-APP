import Link from "next/link";
import { PublicPage } from "@/components/site";
import { DEVELOPER_NAME, DEVELOPER_URL, WHATSAPP_DISPLAY, whatsappLink } from "@/lib/support";
import { SUPPORT_EMAIL } from "@/lib/seo";
import { ContactForm } from "./ContactForm";
import { contactAction } from "./actions";

export const metadata = { title: "Contact", description: "Contact the ProofMyAI team for support, sales or partnerships.", alternates: { canonical: "/contact" } };

export default function ContactPage() {
  return (
    <PublicPage title="Contact us">
      <p>Questions about ProofMyAI, a free AI audit, agency plans or partnerships? Send us a message and we&apos;ll reply within one business day.</p>
      <p>
        Email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> · WhatsApp: <a href={whatsappLink()} target="_blank" rel="noopener">{WHATSAPP_DISPLAY}</a><br />
        Having a problem with the app? <Link href="/support">Submit a support ticket</Link> so we can track it.
      </p>
      <ContactForm action={contactAction} />
      <p className="sub" style={{ marginTop: 18 }}>Need a developer for a custom AI chatbot, agent or automation? Visit <a href={DEVELOPER_URL} target="_blank" rel="noopener">{DEVELOPER_NAME}</a>.</p>
    </PublicPage>
  );
}
