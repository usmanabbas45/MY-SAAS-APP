import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site";
import { POSTS } from "@/lib/blog";
import { jsonLd, SITE_URL } from "@/lib/seo";

export const metadata = {
  title: "Guides: AI chatbot testing, hallucinations, n8n & agent monitoring",
  description: "Practical guides to testing AI chatbots, catching hallucinations, and monitoring n8n, Make and AI agents in production.",
  alternates: { canonical: "/blog" },
};

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default function BlogIndex() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "ProofMyAI Guides",
    url: `${SITE_URL}/blog`,
    blogPost: POSTS.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${SITE_URL}/blog/${p.slug}`, datePublished: p.date })),
  };
  return (
    <>
      <SiteHeader />
      <main className="legal blog">
        <h1>📚 Guides</h1>
        <p className="lp-lead" style={{ textAlign: "left" }}>Practical, no-fluff guides to making AI chatbots, AI agents and n8n/Make automations reliable.</p>
        <div className="post-list">
          {POSTS.map((p) => (
            <article key={p.slug} className="card post-card">
              <div className="faint">{p.tags.join(" · ")} · {p.readMins} min read</div>
              <h2><Link href={`/blog/${p.slug}`}>{p.title}</Link></h2>
              <p className="sub">{p.description}</p>
              <div className="row between"><span className="faint"><time dateTime={p.date}>{fmt(p.date)}</time></span><Link href={`/blog/${p.slug}`}>Read the guide →</Link></div>
            </article>
          ))}
        </div>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(data)} />
    </>
  );
}
