import Link from "next/link";
import { ThemeToggle } from "@/components/client";
import { currentUser } from "@/lib/auth";
import { SOLUTIONS, SUPPORT_EMAIL } from "@/lib/seo";

export async function SiteHeader() {
  const user = await currentUser();
  return (
    <header className="site-header">
      <nav className="lp-nav" aria-label="Main">
        <Link href="/" className="logo" aria-label="ProofMyAI home"><span className="logo-mark" aria-hidden>✓</span>ProofMyAI</Link>
        <div className="site-links">
          <Link href="/#features">Features</Link>
          <Link href="/solutions/ai-chatbot-monitoring">Solutions</Link>
          <Link href="/#pricing">Pricing</Link>
          <Link href="/#faq">FAQ</Link>
        </div>
        <div className="row">
          <ThemeToggle />
          {user ? (
            <Link href="/app" className="btn">Dashboard</Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost">Log in</Link>
              <Link href="/signup" className="btn">Start free</Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div>
          <Link href="/" className="logo" style={{ padding: 0 }}><span className="logo-mark" aria-hidden>✓</span>ProofMyAI</Link>
          <p className="sub" style={{ marginTop: 10, maxWidth: 280 }}>Quality monitoring for AI chatbots, AI agents and n8n/Make workflows. Prove your AI works.</p>
        </div>
        <div>
          <h2 className="foot-h">Product</h2>
          <ul>
            <li><Link href="/#features">Features</Link></li>
            <li><Link href="/#pricing">Pricing</Link></li>
            <li><Link href="/#faq">FAQ</Link></li>
            <li><Link href="/signup">Free AI audit</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="foot-h">Solutions</h2>
          <ul>{SOLUTIONS.map((s) => <li key={s.slug}><Link href={`/solutions/${s.slug}`}>{s.kicker}</Link></li>)}</ul>
        </div>
        <div>
          <h2 className="foot-h">Company</h2>
          <ul>
            <li><Link href="/about">About</Link></li>
            <li><Link href="/contact">Contact</Link></li>
            <li><Link href="/security">Trust Center</Link></li>
            <li><Link href="/dpa">DPA (GDPR)</Link></li>
            <li><Link href="/privacy">Privacy Policy</Link></li>
            <li><Link href="/terms">Terms of Service</Link></li>
            <li><Link href="/refund">Refund Policy</Link></li>
            <li><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></li>
          </ul>
        </div>
      </div>
      <p className="faint" style={{ textAlign: "center", marginTop: 28 }}>© {new Date().getFullYear()} ProofMyAI · Prove your AI works</p>
    </footer>
  );
}

/** Layout for simple public pages (legal, contact). */
export async function PublicPage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="legal">
        <h1>{title}</h1>
        {updated ? <p className="faint">Last updated: {updated}</p> : null}
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
