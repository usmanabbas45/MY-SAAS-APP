import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site";
import { captchaConfig } from "@/lib/captcha";
import { jsonLd, SITE_URL } from "@/lib/seo";
import { AuditForm } from "./AuditForm";
import { requestAuditAction } from "./actions";
import { PLATFORMS } from "./platforms";

export const metadata: Metadata = {
  title: { absolute: "Free AI Chatbot Audit · Find Wrong Answers in 48 Hours | ProofMyAI" },
  description: "Get a free, done-for-you audit of your AI chatbot. We test it with real customer questions and send a report of wrong, made-up and risky answers, with the fix for each one.",
  alternates: { canonical: "/free-audit" },
};
export const dynamic = "force-dynamic";

const STEPS = [
  { icon: "🧪", title: "We test your bot", text: "We ask your chatbot 20+ real customer questions about prices, delivery, refunds, discounts and hand-overs." },
  { icon: "🔍", title: "Every answer checked", text: "Each reply is compared with your own website and policies. Made-up, wrong and risky answers are flagged." },
  { icon: "📄", title: "You get the report", text: "A clear report with screenshots, why each answer is wrong, and the exact text to fix it. Yours to keep." },
];

const FAQ = [
  { q: "Is the audit really free?", a: "Yes. There is no charge and no account needed. We do it so you can see what ProofMyAI catches on your own bot." },
  { q: "What do you need from me?", a: "Just your website address. We test the chatbot the way a customer would, from the outside. Nothing is installed and we never log in to your systems." },
  { q: "How long does it take?", a: "You'll get the report by email within 2 business days." },
  { q: "Which chatbots can you audit?", a: "Any chatbot on a website or WhatsApp: Intercom Fin, Tidio Lyro, Zendesk AI, Crisp, Chatbase, custom GPTs and self-built bots. We can also review n8n or Make automations." },
];

export default async function FreeAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const utm = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign"].filter((k) => sp[k]).map((k) => [k, String(sp[k]).slice(0, 80)]));
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Service", name: "Free AI chatbot audit", provider: { "@id": `${SITE_URL}/#org` }, url: `${SITE_URL}/free-audit`, offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
        description: "A done-for-you audit of an AI chatbot: real customer questions, every answer checked against the business's own policies, with a fix list." },
      { "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };
  return (
    <div className="lp-page">
      <SiteHeader />
      <main>
        <section className="lp-hero lp-hero-split lp-hero-fx audit-hero">
          <div className="hero-spotlight" aria-hidden />
          <div className="lp-hero-copy">
            <span className="shiny-pill"><span className="shiny-pill-new">Free</span><span className="shiny-text">Done for you · no account needed</span></span>
            <h1 style={{ marginTop: 18 }}>Is your chatbot telling customers the truth? <span className="gradient-anim">Get a free audit.</span></h1>
            <p>We test your AI chatbot with real customer questions and send you a report of every wrong, made-up or risky answer, with the fix for each one. Within 2 business days.</p>
            <ul className="lp-trust"><li>✓ 100% free</li><li>✓ Nothing to install</li><li>✓ Report in 2 business days</li></ul>
          </div>
          <AuditForm action={requestAuditAction} captcha={captchaConfig()} platforms={PLATFORMS} utm={utm} />
        </section>

        <section className="lp-section reveal">
          <h2>What you get</h2>
          <div className="grid grid-3" style={{ marginTop: 20 }}>
            {STEPS.map((s, i) => (
              <div key={s.title} className="card">
                <div className="feature-icon" aria-hidden>{s.icon}</div>
                <h3>{i + 1}. {s.title}</h3>
                <p className="sub" style={{ margin: 0 }}>{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section reveal">
          <div className="card audit-sample">
            <span className="badge badge-warn">Example finding</span>
            <div className="audit-sample-row"><b>Customer:</b> Can I return a sale item for a refund?</div>
            <div className="audit-sample-row"><b>Your bot:</b> Of course! Full refund, no questions asked 😊</div>
            <div className="audit-sample-row bad"><b>✕ Made up:</b> Your returns policy says sale items get store credit only. This answer promises money you don&apos;t owe.</div>
            <div className="audit-sample-row ok"><b>✓ Fix:</b> Add &ldquo;Sale items can be exchanged or returned for store credit, not a refund&rdquo; to your Returns article.</div>
          </div>
        </section>

        <section className="lp-section faq reveal">
          <h2>Questions</h2>
          <div style={{ maxWidth: 820, margin: "20px auto 0" }}>
            {FAQ.map((f) => <details key={f.q}><summary>{f.q}</summary><p className="sub" style={{ margin: 0 }}>{f.a}</p></details>)}
          </div>
          <p className="sub" style={{ textAlign: "center", marginTop: 18 }}>Prefer to do it yourself? <Link href="/tools/ai-chatbot-checker">Try the free answer checker</Link> or <Link href="/signup">start a free account</Link>.</p>
        </section>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(data)} />
    </div>
  );
}
