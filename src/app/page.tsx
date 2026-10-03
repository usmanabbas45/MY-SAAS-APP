import { PLAN_FEATURES, PLANS as PLANS_BY_ID } from "@/lib/billing";
import Link from "next/link";
import { ScoreRing } from "@/components/ui";
import { SiteFooter, SiteHeader } from "@/components/site";
import { DemoVideo } from "@/components/video";
import { CatchDemo, HeroMockup, IntegrationStrip, StepArt } from "@/components/illustrations";
import { foundingSpotsLeft } from "@/lib/founding";
import { FOUNDING_OFFER, publishedTestimonials, ratingSummary } from "@/lib/testimonials";
import { LEGAL_NAME } from "@/lib/legal";
import { DEVELOPER_URL } from "@/lib/support";
import { FAQS, jsonLd, SAME_AS, SUPPORT_EMAIL, SITE_DESCRIPTION, SITE_NAME, SITE_URL, VIDEOS, DEMO_VIDEO, demoVideoJsonLd, videoJsonLd } from "@/lib/seo";

const FEATURES = [
  { icon: "💬", title: "Chatbot audits", text: "Upload transcripts from Intercom, Tidio, Crisp, Zendesk or any bot. Every answer is graded against your help docs: correct, made up, not in docs, should have escalated, off-policy." },
  { icon: "🧪", title: "Nightly bot tests", text: "Save real customer questions with the facts a right answer must contain. ProofMyAI asks your bot every night and alerts you the moment an answer gets worse." },
  { icon: "🤖", title: "AI agent monitoring", text: "Send each agent run with one HTTP call. Catch loops, tool errors, runaway costs, empty outputs and answers the tools never supported." },
  { icon: "⚙️", title: "n8n & Make monitoring", text: "Connect n8n or Make in two minutes. Get alerted on failures, silent failures (success with zero output), error-rate spikes and workflows that stopped running." },
  { icon: "✨", title: "Fix with AI, not just a score", text: "Problems are grouped by the help article that caused them. One click writes the corrected article and a safe system prompt for your bot." },
  { icon: "📡", title: "Live tracking", text: "Connect your bot, agents and workflows once and watch every answer and run checked in real time, with a clear ✓ working / ✕ problem feed." },
  { icon: "🔒", title: "Privacy built in", text: "Emails, phone numbers, card numbers and IBANs are masked before anything is stored or checked by AI. Your own rules (\"never say…\") are enforced on every answer." },
  { icon: "📄", title: "Client-ready reports", text: "Share a read-only report link or save it as a PDF, with your agency's name on it. Export everything to CSV and get a weekly summary email." },
  { icon: "🛡️", title: "Safety & security checks", text: "Catch prompt-injection and jailbreak attempts, leaked system prompts, exposed card numbers, rude replies and answers in the wrong language." },
  { icon: "🟢", title: "Uptime & speed", text: "Monitor your chatbot, website or API every minute. Get an alert when it goes down or slows down, and when it's back." },
  { icon: "👥", title: "Team & client access", text: "Invite teammates or clients as viewers or editors. Perfect for agencies sharing results without sharing passwords." },
  { icon: "🧠", title: "Learns your business", text: "Mark any verdict right or wrong. A neural network trained on your own feedback re-ranks risk so the answers that matter rise to the top." },
];

const PLANS = [
  { name: "Starter", price: PLANS_BY_ID.starter.price, featured: false, items: PLAN_FEATURES.starter },
  { name: "Growth", price: PLANS_BY_ID.growth.price, featured: true, items: PLAN_FEATURES.growth },
  { name: "Agency", price: PLANS_BY_ID.agency.price, featured: false, items: PLAN_FEATURES.agency },
  { name: "Compliance", price: PLANS_BY_ID.compliance.price, featured: false, items: PLAN_FEATURES.compliance },
];

export const dynamic = "force-dynamic"; // approved testimonials appear without a redeploy

export const metadata = {
  title: { absolute: "ProofMyAI · AI Chatbot, AI Agent & n8n Workflow Monitoring" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icon.png`,
      description: SITE_DESCRIPTION,
      founder: { "@type": "Person", name: LEGAL_NAME, url: DEVELOPER_URL, jobTitle: "Founder and AI automation developer" },
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: SUPPORT_EMAIL, url: `${SITE_URL}/support`, availableLanguage: ["English", "Urdu"] },
      sameAs: SAME_AS,
    },
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: SITE_NAME, url: SITE_URL, publisher: { "@id": `${SITE_URL}/#org` } },
    {
      "@type": "SoftwareApplication", name: SITE_NAME, url: SITE_URL, applicationCategory: "BusinessApplication", operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      offers: PLANS.map((p) => ({ "@type": "Offer", name: p.name, price: p.price, priceCurrency: "USD" })),
    },
    { "@type": "FAQPage", mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    demoVideoJsonLd(),
    videoJsonLd(VIDEOS.marketing),
    videoJsonLd(VIDEOS.tutorial),
  ],
};

function FoundingOffer() {
  const left = foundingSpotsLeft();
  if (left <= 0) return null;
  return (
    <section className="lp-section" id="founding">
      <div className="card founding">
        <div className="founding-icon" aria-hidden>🚀</div>
        <h2>Become a founding customer</h2>
        <p className="lp-lead" style={{ marginTop: 8 }}>
          ProofMyAI is new, so our first {FOUNDING_OFFER.spots} businesses running AI chatbots, agents or n8n/Make automations get
          <strong> {FOUNDING_OFFER.reward}</strong> and direct WhatsApp access to the developer. No card needed, no automatic charge. We ask for {FOUNDING_OFFER.ask}.
        </p>
        <div className="row" style={{ justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
          <Link href="/signup?founding=1" className="btn">🎉 Claim a founding spot</Link>
        </div>
        <p className="faint" style={{ marginTop: 10 }}>{left} of {FOUNDING_OFFER.spots} spots left · activates instantly</p>
      </div>
    </section>
  );
}

function SocialProof() {
  const quotes = publishedTestimonials(6);
  const rating = ratingSummary();
  if (quotes.length === 0) return <FoundingOffer />;
  return (
    <>
      <section className="lp-section" id="customers" aria-labelledby="customers-title">
        <h2 id="customers-title">💬 What customers say</h2>
        <p className="lp-lead">
          Real feedback from ProofMyAI users, shown with their permission.
          {rating ? <> Average rating <strong>{rating.avg.toFixed(1)} / 5</strong> from {rating.count} customers.</> : null}
        </p>
        <div className="testimonials">
          {quotes.map((t) => (
            <figure key={t.id} className="card testimonial">
              <div className="stars" aria-label={`${t.rating} out of 5`}>{"★".repeat(t.rating)}{"☆".repeat(5 - t.rating)}</div>
              <blockquote>&ldquo;{t.quote}&rdquo;</blockquote>
              {t.result ? <div className="result">✓ {t.result}</div> : null}
              <figcaption>
                <strong>{t.name}</strong>
                <div className="faint">
                  {[t.role, t.company].filter(Boolean).join(", ")}
                  {t.website ? <> · <a href={t.website} target="_blank" rel="noopener nofollow">{t.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a></> : null}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      <FoundingOffer />
    </>
  );
}

export default function Landing() {
  return (
    <div>
      <SiteHeader />

      <main>
      <section className="lp-hero lp-hero-split">
        <div className="lp-hero-copy">
          <span className="badge badge-brand">For businesses running AI chatbots, agents and automations</span>
          <h1 style={{ marginTop: 16 }}>Your AI talks to customers 24/7.<br /><span className="gradient-text">Know when it gets things wrong.</span></h1>
          <p>ProofMyAI checks your chatbot&apos;s answers, your AI agent runs and your n8n/Make workflows, then tells you exactly what broke and how to fix it, before your customers notice.</p>
          <div className="row lp-hero-ctas">
            <Link href="/signup" className="btn btn-lg">Get your free AI audit →</Link>
            <a href="#video" className="btn btn-ghost btn-lg">▶ Watch the 75-sec demo</a>
          </div>
          <ul className="lp-trust">
            <li>✓ Free for 50 conversations a month</li>
            <li>✓ No card needed</li>
            <li>✓ Set up in 5 minutes</li>
          </ul>
        </div>
        <HeroMockup />
      </section>

      <section className="lp-section lp-works" aria-label="Works with">
        <p className="lp-works-title">Works with the tools you already use</p>
        <IntegrationStrip />
      </section>

      <section className="lp-section" id="how-it-catches" aria-labelledby="catch-title">
        <h2 id="catch-title">See a wrong answer caught in seconds</h2>
        <p className="lp-lead">Your bot sounds confident even when it&apos;s wrong. ProofMyAI checks every answer against your own help docs and tells you what to fix.</p>
        <CatchDemo />
      </section>

      <section className="lp-section" id="video" aria-labelledby="video-title">
        <h2 id="video-title">See ProofMyAI in 75 seconds</h2>
        <p className="lp-lead">Connect in 2 minutes, catch wrong answers with the exact fix, and get alerted before your customers notice.</p>
        <div className="video-wrap">
          <DemoVideo src={DEMO_VIDEO.src} webm={DEMO_VIDEO.webm} poster={DEMO_VIDEO.poster} title={DEMO_VIDEO.title} />
          <p className="sub" style={{ textAlign: "center", marginTop: 14 }}>
            Ready to set it up? <a href={`https://www.youtube.com/watch?v=${VIDEOS.tutorial.id}`} target="_blank" rel="noopener">Watch the 3-minute setup tutorial ↗</a>
          </p>
        </div>
      </section>

      <section className="lp-section">
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center" }}>
          <ScoreRing score={72} size={150} />
          <div style={{ flex: "1 1 280px" }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <span className="badge badge-warn">Illustrative example</span>
              <span className="faint">Sample numbers, not a real customer</span>
            </div>
            <h3>What a first audit report looks like for an online store</h3>
            <p className="sub">412 chatbot answers checked · 31 made-up answers (mostly shipping prices) · 9 refund disputes never handed to a human · 1 n8n order-sync workflow silently returning zero orders for 3 days.</p>
            <p className="sub" style={{ margin: 0 }}>Top fix: <strong>update the &quot;Shipping rates&quot; article</strong>. It caused 22 of the 31 wrong answers.</p>
            <p className="faint" style={{ margin: "8px 0 0" }}>These figures show the format of a ProofMyAI report. <Link href="/signup">Run a free audit</Link> to see your own numbers.</p>
          </div>
        </div>
      </section>

      <section className="lp-section" id="features">
        <h2>Everything your AI does, checked in one place</h2>
        <p className="lp-lead">Customers are losing trust in support bots, and most bot platforms have no built-in quality control. ProofMyAI is the independent auditor that works with all of them.</p>
        <div className="grid grid-3">
          {FEATURES.map((f) => (
            <div className="card feature-card" key={f.title}>
              <div className="feature-icon" aria-hidden>{f.icon}</div>
              <h3>{f.title}</h3>
              <p className="sub" style={{ margin: 0 }}>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <h2>Set up in 3 steps</h2>
        <p className="lp-lead">No code needed for chatbots and workflows. Agents need one HTTP call.</p>
        <div className="grid grid-3 steps" style={{ marginTop: 24 }}>
          {([
            [1, "Connect", "Upload a chat export, paste your bot's URL, add an n8n/Make key, or add one HTTP call to your agent."],
            [2, "Check", "AI grades every answer and run against your own docs and limits. Results in minutes."],
            [3, "Fix & relax", "Follow the fix list. Nightly tests and live monitoring alert you on Slack or email if anything breaks again."],
          ] as const).map(([n, t, d]) => (
            <div className="card step-card" key={n}>
              <StepArt step={n} />
              <div className="row" style={{ gap: 10, marginTop: 16 }}><span className="step-num">{n}</span><h3 style={{ margin: 0 }}>{t}</h3></div>
              <p className="sub" style={{ margin: "8px 0 0" }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <SocialProof />

      <section className="lp-section" id="pricing">
        <h2>Simple pricing</h2>
        <p className="lp-lead"><strong>Free forever for 50 conversations a month</strong>, no card needed. Every paid plan includes a 14-day free trial and a 14-day money-back guarantee.</p>
        <div className="grid grid-4">
          {PLANS.map((p) => (
            <div className={`card plan ${p.featured ? "featured" : ""}`} key={p.name}>
              <div className="row between">
                <h3>{p.name}</h3>
                {p.featured ? <span className="badge badge-brand">Most popular</span> : p.name === "Compliance" ? <span className="badge badge-info">Regulated</span> : null}
              </div>
              <div className="price">${p.price}<small>/month</small></div>
              <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
              <Link href={p.name === "Compliance" ? "/contact" : "/signup"} className={`btn ${p.featured ? "" : "btn-ghost"}`} style={{ width: "100%" }}>{p.name === "Compliance" ? "Talk to us" : "Start free"}</Link>
            </div>
          ))}
        </div>
        <p className="sub" style={{ textAlign: "center", marginTop: 14 }}>Strict data rules? Results-only storage, auto-delete, AI provider off, a signed DPA or a <strong>self-hosted</strong> ProofMyAI. <Link href="/security">See the Trust Center</Link>.</p>
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

      <section className="lp-section">
        <div className="cta-banner">
          <h2>Is your AI telling customers the truth?</h2>
          <p>Find out in 5 minutes with a free AI audit. No card needed.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link href="/signup" className="btn btn-lg btn-white">Get your free AI audit →</Link>
            <a href="#pricing" className="btn btn-lg btn-outline-white">See pricing</a>
          </div>
        </div>
      </section>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
    </div>
  );
}
