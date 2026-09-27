import { PublicPage } from "@/components/site";
import { SUPPORT_EMAIL } from "@/lib/seo";
import { ContactForm } from "./ContactForm";
import { contactAction } from "./actions";

export const metadata = { title: "Contact", description: "Contact the ProofMyAI team for support, sales or partnerships.", alternates: { canonical: "/contact" } };

export default function ContactPage() {
  return (
    <PublicPage title="Contact us">
      <p>Questions about ProofMyAI, a free AI audit, agency plans or partnerships? Send us a message and we&apos;ll reply within one business day.</p>
      <p>Email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
      <ContactForm action={contactAction} />
    </PublicPage>
  );
}
