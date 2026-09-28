import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site";
import { jsonLd, SITE_URL, SOLUTIONS } from "@/lib/seo";

export function generateStaticParams() {
  return SOLUTIONS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = SOLUTIONS.find((x) => x.slug === slug);
  if (!s) return {};
  return {
    title: s.title,
    description: s.description,
    alternates: { canonical: `/solutions/${s.slug}` },
    openGraph: { title: `${s.title} · ProofMyAI`, description: s.description, url: `/solutions/${s.slug}` },
  };
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = SOLUTIONS.find((x) => x.slug === slug);
  if (!s) notFound();
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "ProofMyAI", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: s.kicker, item: `${SITE_URL}/solutions/${s.slug}` },
      ] },
      { "@type": "FAQPage", mainEntity: s.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };
  return (
    <>
      <SiteHeader />
      <main>
        <section className="lp-hero">
          <span className="badge badge-brand">{s.kicker}</span>
          <h1 style={{ marginTop: 16 }}>{s.title}</h1>
          <p>{s.intro}</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link href="/signup" className="btn btn-lg">Start free →</Link>
            <Link href="/#pricing" className="btn btn-ghost btn-lg">See pricing</Link>
          </div>
        </section>

        <section className="lp-section">
          <h2>The problem</h2>
          <div className="grid grid-2" style={{ marginTop: 20 }}>
            {s.problems.map((p) => <div key={p} className="card"><p style={{ margin: 0 }}>⚠️ {p}</p></div>)}
          </div>
        </section>

        <section className="lp-section">
          <h2>How ProofMyAI solves it</h2>
          <div className="grid grid-3" style={{ marginTop: 20 }}>
            {s.steps.map((st, i) => (
              <div key={st.title} className="card">
                <div className="feature-icon" style={{ fontWeight: 800 }}>{i + 1}</div>
                <h3>{st.title}</h3>
                <p className="sub" style={{ margin: 0 }}>{st.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section">
          <h2>What you get</h2>
          <ul className="grid grid-2" style={{ listStyle: "none", padding: 0, marginTop: 20 }}>
            {s.features.map((f) => <li key={f} className="card">✅ {f}</li>)}
          </ul>
        </section>

        <section className="lp-section faq">
          <h2>Questions</h2>
          <div style={{ maxWidth: 820, margin: "20px auto 0" }}>
            {s.faqs.map((f) => <details key={f.q}><summary>{f.q}</summary><p className="sub" style={{ margin: 0 }}>{f.a}</p></details>)}
          </div>
        </section>

        <section className="lp-section" style={{ textAlign: "center" }}>
          <h2>Try it free today</h2>
          <p className="lp-lead">Set up in minutes. No card needed.</p>
          <Link href="/signup" className="btn btn-lg">Get your free AI audit →</Link>
          <p className="sub" style={{ marginTop: 18 }}>
            Also see: {SOLUTIONS.filter((x) => x.slug !== s.slug).map((x, i) => <span key={x.slug}>{i ? " · " : ""}<Link href={`/solutions/${x.slug}`}>{x.kicker}</Link></span>)}
          </p>
        </section>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(data)} />
    </>
  );
}
