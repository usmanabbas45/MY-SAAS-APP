import Link from "next/link";
import { CopyButton, ThemeToggle } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { MAX_PER_YEAR, referralStats, refLink } from "@/lib/referrals";
import { logoutAction } from "../../(auth)/actions";

export const metadata = { title: "Invite & earn" };
export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  const user = await requireUser();
  const link = refLink(user.id);
  const s = referralStats(user.id);
  const projects = listProjects(user.id).filter((p) => !p.is_demo);
  const message = "I use ProofMyAI to catch my AI chatbot's wrong answers before customers see them. Sign up with my link and we both get a month free:";
  const enc = encodeURIComponent;
  const shares: [string, string, string][] = [
    ["WhatsApp", "💬", `https://wa.me/?text=${enc(`${message} ${link}`)}`],
    ["LinkedIn", "💼", `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}`],
    ["X", "𝕏", `https://twitter.com/intent/tweet?text=${enc(message)}&url=${enc(link)}`],
    ["Email", "✉️", `mailto:?subject=${enc("A tool that checks AI chatbot answers")}&body=${enc(`${message}\n\n${link}`)}`],
  ];

  return (
    <div>
      <nav className="lp-nav">
        <Link href="/app?new=1" className="logo"><span className="logo-mark" aria-hidden>✓</span>ProofMyAI</Link>
        <div className="row">
          <ThemeToggle />
          <form action={logoutAction}><button className="btn btn-ghost btn-sm">Log out</button></form>
        </div>
      </nav>
      <main className="content" style={{ margin: "0 auto", maxWidth: 900 }}>
        <p className="sub"><Link href={projects[0] ? `/app/p/${projects[0].id}` : "/app"}>← Back to dashboard</Link></p>

        <div className="ref-hero">
          <div className="ref-gift" aria-hidden>🎁</div>
          <h1>Give a month, get a month</h1>
          <p>Invite a friend to ProofMyAI. When they become a paying customer, <strong>you both get your next month free</strong>.</p>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your invite link</h2>
          <div className="ref-link">
            <code>{link}</code>
            <CopyButton text={link} label="Copy link" />
          </div>
          <div className="ref-shares">
            {shares.map(([name, icon, href]) => (
              <a key={name} href={href} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm"><span aria-hidden>{icon}</span> Share on {name}</a>
            ))}
          </div>
        </div>

        <div className="grid grid-4" style={{ marginTop: 16 }}>
          <div className="card stat"><span className="stat-label">Friends signed up</span><span className="stat-value">{s.signedUp}</span></div>
          <div className="card stat"><span className="stat-label">Became customers</span><span className="stat-value">{s.paying}</span></div>
          <div className="card stat"><span className="stat-label">Free months earned</span><span className="stat-value">{s.applied + s.pending}</span><span className="stat-foot">{s.pending ? `${s.pending} waiting to be applied` : "Applied to your bills"}</span></div>
          <div className="card stat"><span className="stat-label">You saved</span><span className="stat-value">${s.savedUsd}</span></div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>How it works</h2>
          <ol className="ref-steps">
            <li><strong>Share your link</strong> with anyone who runs a chatbot, AI agent or n8n/Make workflows.</li>
            <li><strong>They sign up</strong> within 60 days of clicking it, and start any paid plan.</li>
            <li><strong>When they make their first payment</strong>, you both get one month of your own plan free on your next bill.</li>
          </ol>
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            On the Free plan? Your free month waits until you choose a paid plan. On a yearly plan, it comes off your next renewal.
            Up to {MAX_PER_YEAR} free months a year. Rewards aren&apos;t cash and can&apos;t be exchanged. <Link href="/terms#referrals">Referral terms</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
