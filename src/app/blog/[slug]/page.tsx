import Link from "next/link";
import { notFound } from "next/navigation";
import { headings, Prose } from "@/components/prose";
import { SiteFooter, SiteHeader } from "@/components/site";
import { postBySlug, POSTS } from "@/lib/blog";
import { LEGAL_NAME } from "@/lib/legal";
import { jsonLd, SITE_NAME, SITE_URL } from "@/lib/seo";
import { DEVELOPER_URL } from "@/lib/support";

export const dynamicParams = false;
export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = postBySlug((await params).slug);
  if (!p) return {};
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: `/blog/${p.slug}` },
    authors: [{ name: LEGAL_NAME, url: DEVELOPER_URL }],
    openGraph: { type: "article", title: p.title, description: p.description, url: `/blog/${p.slug}`, publishedTime: p.date, modifiedTime: p.updated ?? p.date, authors: [LEGAL_NAME] },
  };
}

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = postBySlug((await params).slug);
  if (!p) notFound();
  const url = `${SITE_URL}/blog/${p.slug}`;
  const toc = headings(p.body);
  const related = POSTS.filter((x) => x.slug !== p.slug && x.tags.some((t) => p.tags.includes(t))).slice(0, 3);
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article", "@id": `${url}#article`, headline: p.title, description: p.description, url, mainEntityOfPage: url,
        datePublished: p.date, dateModified: p.updated ?? p.date, image: `${SITE_URL}/opengraph-image.png`, keywords: p.tags.join(", "),
        author: { "@type": "Person", name: LEGAL_NAME, url: DEVELOPER_URL },
        publisher: { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.png` } },
        abstract: p.answer,
      },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/blog` },
        { "@type": "ListItem", position: 3, name: p.title, item: url },
      ] },
      { "@type": "FAQPage", mainEntity: p.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };
  return (
    <>
      <SiteHeader />
      <main className="legal blog">
        <nav className="faint" aria-label="Breadcrumb"><Link href="/">Home</Link> › <Link href="/blog">Guides</Link></nav>
        <h1>{p.title}</h1>
        <p className="faint">By <a href={DEVELOPER_URL} target="_blank" rel="noopener author">{LEGAL_NAME}</a> · <time dateTime={p.updated ?? p.date}>{fmt(p.updated ?? p.date)}</time> · {p.readMins} min read</p>
        <div className="answer-box"><strong>Short answer:</strong> {p.answer}</div>
        {toc.length > 2 ? (
          <nav className="card docs-toc" aria-label="On this page"><strong>📑 In this guide</strong><ol>{toc.map((h) => <li key={h.id}><a href={`#${h.id}`}>{h.text}</a></li>)}</ol></nav>
        ) : null}
        <Prose source={p.body} />
        <div className="card takeaways">
          <h2 style={{ marginTop: 0 }}>✅ Key takeaways</h2>
          <ul>{p.takeaways.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <h2>❓ Frequently asked questions</h2>
        {p.faqs.map((f) => <details key={f.q} open><summary>{f.q}</summary><p className="sub" style={{ margin: "8px 0 0" }}>{f.a}</p></details>)}
        <div className="card founding" style={{ marginTop: 28 }}>
          <h2 style={{ marginTop: 0 }}>{p.cta.text}</h2>
          <p className="sub">Free plan, no card needed. Set up in minutes.</p>
          <Link href={p.cta.href} className="btn">Start free →</Link>
        </div>
        {related.length ? (
          <>
            <h2>📚 Related guides</h2>
            <ul>{related.map((r) => <li key={r.slug}><Link href={`/blog/${r.slug}`}>{r.title}</Link></li>)}</ul>
          </>
        ) : null}
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(data)} />
    </>
  );
}
