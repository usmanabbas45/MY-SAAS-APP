import { PLAN_FEATURES, PLANS as PLANS_BY_ID } from "@/lib/billing";
import Link from "next/link";
import { ScoreRing } from "@/components/ui";
import { SiteFooter, SiteHeader } from "@/components/site";
import { FAQS, jsonLd, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";

const FEATURES = [
  { icon: "💬", title: "Chatbot audits", text: "Upload transcripts from Intercom, Tidio, Crisp, Zendesk or any bot. Every answer is graded against your help docs: correct, made up, not in docs, should have escalated, off-policy." },
  { icon: "🧪", title: "Nightly bot tests", text: "Save real customer questions with the facts a right answer must contain. ProofMyAI asks your bot every night and alerts you the moment an answer gets worse." },
  { icon: "🤖", title: "AI agent monitoring", text: "Send each agent run with one HTTP call. Catch loops, tool errors, runaway costs, empty outputs and answers the tools never supported." },
  { icon: "⚙️", title: "n8n & Make monitoring", text: "Connect n8n or Make in two minutes. Get alerted on failures, silent failures (success with zero output), error-rate spikes and workflows that stopped running." },
  { icon: "📋", title: "Fix list, not just a score", text: "Problems are grouped by the help article that caused them, so you know exactly which page to update first." },
  { icon: "📡", title: "Live tracking", text: "Connect your bot, agents and workflows once and watch every answer and run checked in real time, with a clear ✓ working / ✕ problem feed." },
  { icon: "🔒", title: "Privacy built in", text: "Emails, phone numbers, card numbers and IBANs are masked before anything is stored or checked by AI. Your own rules (\"never say…\") are enforced on every answer." },
  { icon: "📄", title: "Client-ready reports", text: "Share a read-only report link or save it as a PDF, with your agency's name on it. Export everything to CSV and get a weekly summary email." },
  { icon: "🧠", title: "Learns your business", text: "Mark any verdict right or wrong. A neural network trained on your own feedback re-ranks risk so the answers that matter rise to the top." },
];

const PLANS = [
  { name: "Starter", price: PLANS_BY_ID.starter.price, featured: false, items: PLAN_FEATURES.starter },
  { name: "Growth", price: PLANS_BY_ID.growth.price, featured: true, items: PLAN_FEATURES.growth },
  { name: "Agency", price: PLANS_BY_ID.agency.price, featured: false, items: PLAN_FEATURES.agency },
];

export const metadata = {
  title: { absolute: "ProofMyAI · AI Chatbot, AI Agent & n8n Workflow Monitoring" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icon.png` },
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: SITE_NAME, url: SITE_URL, publisher: { "@id": `${SITE_URL}/#org` } },
    {
      "@type": "SoftwareApplication", name: SITE_NAME, url: SITE_URL, applicationCategory: "BusinessApplication", operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      offers: PLANS.map((p) => ({ "@type": "Offer", name: p.name, price: p.price, priceCurrency: "USD" })),
    },
    { "@type": "FAQPage", mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ],
};

export default function Landing() {
  return (
    <div>
      <SiteHeader />

      <main>
      <section className="lp-hero">
        <span className="badge badge-brand">For businesses running AI chatbots, agents and automations</span>
        <h1 style={{ marginTop: 16 }}>Your AI talks to customers 24/7.<br /><span className="gradient-text">Know when it gets things wrong.</span></h1>
        <p>ProofMyAI checks every chatbot answer, every AI agent run and every n8n/Make workflow, then tells you exactly what broke and how to fix it, before your customers notice.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/signup" className="btn btn-lg">Get your free AI audit →</Link>
          <a href="#features" className="btn btn-ghost btn-lg">How it works</a>
        </div>
        <div className="chip-row">
          {["Intercom", "Tidio", "Crisp", "Zendesk", "Chatbase", "Custom GPTs", "n8n", "Make", "LangChain", "OpenAI Agents", "Claude agents"].map((c) => (
            <span key={c} className="badge">{c}</span>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center" }}>
          <ScoreRing score={72} size={150} />
          <div style={{ flex: "1 1 280px" }}>
            <h3>Example: an online store&apos;s first audit</h3>
            <p className="sub">412 chatbot answers checked · 31 made-up answers (mostly shipping prices) · 9 refund disputes never handed to a human · 1 n8n order-sync workflow silently returning zero orders for 3 days.</p>
            <p className="sub" style={{ margin: 0 }}>Top fix: <strong>update the &quot;Shipping rates&quot; article</strong>. It caused 22 of the 31 wrong answers.</p>
          </div>
        </div>
      </section>

      <section className="lp-section" id="features">
        <h2>Everything your AI does, checked in one place</h2>
        <p className="lp-lead">Customers are losing trust in support bots, and most bot platforms have no built-in quality control. ProofMyAI is the independent auditor that works with all of them.</p>
        <div className="grid grid-3">
          {FEATURES.map((f) => (
            <div className="card" key={f.title}>
              <div className="feature-icon" aria-hidden>{f.icon}</div>
              <h3>{f.title}</h3>
              <p className="sub" style={{ margin: 0 }}>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <h2>Set up in 3 steps</h2>
        <div className="grid grid-3" style={{ marginTop: 24 }}>
          {[
            ["1", "Connect", "Upload a chat export, paste your bot's URL, add an n8n/Make key, or add one HTTP call to your agent."],
            ["2", "Check", "AI grades every answer and run against your own docs and limits. Results in minutes."],
            ["3", "Fix & relax", "Follow the fix list. Nightly tests and live monitoring alert you on Slack or email if anything breaks again."],
          ].map(([n, t, d]) => (
            <div className="card" key={n}>
              <div className="feature-icon" style={{ fontWeight: 800 }}>{n}</div>
              <h3>{t}</h3>
              <p className="sub" style={{ margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section" id="pricing">
        <h2>Simple pricing</h2>
        <p className="lp-lead">Start free with a one-time audit of up to 100 conversations. No card needed. Every paid plan includes a 14-day free trial and a 14-day money-back guarantee.</p>
        <div className="grid grid-3">
          {PLANS.map((p) => (
            <div className={`card plan ${p.featured ? "featured" : ""}`} key={p.name}>
              <div className="row between">
                <h3>{p.name}</h3>
                {p.featured ? <span className="badge badge-brand">Most popular</span> : null}
              </div>
              <div className="price">${p.price}<small>/month</small></div>
              <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
              <Link href="/signup" className={`btn ${p.featured ? "" : "btn-ghost"}`} style={{ width: "100%" }}>Start free</Link>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section faq" id="faq">
        <h2>Frequently asked questions</h2>
        <p className="lp-lead">Everything you need to know before your first AI audit.</p>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p className="sub" style={{ margin: 0 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-section" style={{ textAlign: "center" }}>
        <h2>Is your AI telling customers the truth?</h2>
        <p className="lp-lead">Find out in 5 minutes with a free AI audit.</p>
        <Link href="/signup" className="btn btn-lg">Get your free AI audit →</Link>
      </section>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
    </div>
  );
}
