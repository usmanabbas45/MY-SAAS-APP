import Link from "next/link";
import { CookieSettingsLink } from "@/components/analytics";
import { ThemeToggle } from "@/components/client";
import { currentUser } from "@/lib/auth";
import { SOLUTIONS, SUPPORT_EMAIL } from "@/lib/seo";
import { DEVELOPER_NAME, DEVELOPER_URL, whatsappLink } from "@/lib/support";

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
          <Link href="/blog">Guides</Link>
          <Link href="/docs">Docs</Link>
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
            <li><Link href="/blog">Guides</Link></li>
            <li><Link href="/docs">Docs &amp; API</Link></li>
            <li><Link href="/changelog">Changelog</Link></li>
            <li><Link href="/status">System status</Link></li>
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
            <li><Link href="/support">Support &amp; report an issue</Link></li>
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
      <div className="featured-on" aria-label="Featured on">
        <a href="https://www.producthunt.com/products/proofmy-ai?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-proofmy-ai" target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="ProofMy Ai - Catch AI hallucinations before your customers do | Product Hunt" width={250} height={54} src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1265385&theme=light&t=1790960003109" />
        </a>
        <a href="https://launchstag.com/p/proofmy-ai" target="_blank" rel="noopener">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://launchstag.com/badge-light.svg" alt="Featured on Launchstag" width={198} height={62} style={{ height: 44, width: "auto" }} />
        </a>
      </div>
      <p className="sub" style={{ textAlign: "center", marginTop: 24 }}>
        Need a custom AI chatbot, agent or n8n automation? <a href={DEVELOPER_URL} target="_blank" rel="noopener">Hire the developer behind ProofMyAI: {DEVELOPER_NAME} ↗</a>
      </p>
      <p className="faint" style={{ textAlign: "center", marginTop: 8 }}>© {new Date().getFullYear()} ProofMyAI · Prove your AI works{process.env.GA_MEASUREMENT_ID ? <> · <CookieSettingsLink /></> : null}</p>
      <a className="wa-float" href={whatsappLink()} target="_blank" rel="noopener" aria-label="Chat with us on WhatsApp">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.3Z" /></svg>
        <span className="wa-label">Need help?</span>
      </a>
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
