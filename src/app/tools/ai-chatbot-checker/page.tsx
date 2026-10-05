import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site";
import { captchaConfig } from "@/lib/captcha";
import { FREE_CHECK_LIMITS } from "@/lib/freecheck";
import { jsonLd, SITE_URL } from "@/lib/seo";
import { CheckerForm } from "./CheckerForm";
import { freeCheckAction } from "./actions";

export const metadata: Metadata = {
  title: { absolute: "Free AI Chatbot Answer Checker · Hallucination Test | ProofMyAI" },
  description: "Free tool: paste a customer question, your chatbot's answer and your policy. See instantly if the answer is correct, made up, not in your docs or should have gone to a human.",
  alternates: { canonical: "/tools/ai-chatbot-checker" },
};
export const dynamic = "force-dynamic";

const VERDICTS = [
  ["✓ Correct", "Matches your policy, or safely says it doesn't know."],
  ["✕ Made up", "Invents prices, dates, discounts or policies that contradict your docs."],
  ["! Not in your docs", "Might be true, but nothing in your policy backs it up."],
  ["✕ Should escalate", "A refund dispute, complaint or legal issue that needed a human."],
  ["✕ Off policy", "Promises you never authorised, rude replies or leaked information."],
  ["? Unclear", "Too vague or confusing to help the customer."],
];

const FAQ = [
  { q: "How do I test if my chatbot is hallucinating?", a: "Ask it real customer questions about prices, delivery, refunds and discounts, then compare each answer with your help docs. This free checker does the comparison for one answer. ProofMyAI does it automatically for every conversation." },
  { q: "Is this chatbot checker free?", a: "Yes. It's free with no sign-up, and nothing you paste is stored." },
  { q: "Does it work with Intercom Fin, Tidio Lyro, Zendesk AI or ChatGPT bots?", a: "Yes. Copy the question and answer from any chatbot. To check every conversation automatically, connect the bot to a free ProofMyAI account." },
  { q: "What should I paste as the policy?", a: "The part of your help center, FAQ or terms that covers the question, for example your shipping or returns article. The more exact, the better the check." },
];

export default function CheckerPage() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebApplication", name: "AI Chatbot Answer Checker", url: `${SITE_URL}/tools/ai-chatbot-checker`, applicationCategory: "BusinessApplication", operatingSystem: "Web",
        offers: { "@type": "Offer", price: 0, priceCurrency: "USD" }, publisher: { "@id": `${SITE_URL}/#org` },
        description: "Checks a chatbot answer against your own policy text and labels it correct, made up, not in docs, should escalate, off policy or unclear." },
      { "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };
  return (
    <div className="lp-page">
      <SiteHeader />
      <main>
        <section className="lp-hero lp-hero-fx">
          <div className="hero-spotlight" aria-hidden />
          <span className="shiny-pill"><span className="shiny-pill-new">Free tool</span><span className="shiny-text">No sign-up · nothing stored</span></span>
          <h1 style={{ marginTop: 18 }}>AI Chatbot Answer Checker: <span className="gradient-anim">is your bot making things up?</span></h1>
          <p>Paste a customer&apos;s question, your chatbot&apos;s answer and your policy. See in seconds if the answer is correct, made up, not in your docs or should have gone to a human.</p>
        </section>

        <section className="lp-section" style={{ paddingTop: 0 }}>
          <CheckerForm action={freeCheckAction} captcha={captchaConfig()} limits={FREE_CHECK_LIMITS} />
        </section>

        <section className="lp-section reveal">
          <h2>What the checker looks for</h2>
          <div className="grid grid-3" style={{ marginTop: 20 }}>
            {VERDICTS.map(([t, d]) => <div key={t} className="card"><h3>{t}</h3><p className="sub" style={{ margin: 0 }}>{d}</p></div>)}
          </div>
          <p className="sub" style={{ textAlign: "center", marginTop: 16 }}>It also flags safety problems: card numbers or personal data in replies, prompt-injection attempts, leaked system prompts and rude answers.</p>
        </section>

        <section className="lp-section faq reveal">
          <h2>Questions</h2>
          <div style={{ maxWidth: 820, margin: "20px auto 0" }}>
            {FAQ.map((f) => <details key={f.q}><summary>{f.q}</summary><p className="sub" style={{ margin: 0 }}>{f.a}</p></details>)}
          </div>
          <p className="sub" style={{ textAlign: "center", marginTop: 18 }}>Learn more: <Link href="/solutions/ai-chatbot-monitoring">AI chatbot monitoring</Link> · <Link href="/blog">Guides</Link></p>
        </section>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(data)} />
    </div>
  );
}
