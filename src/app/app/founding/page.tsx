import Link from "next/link";
import { SubmitButton, ThemeToggle } from "@/components/client";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { foundingSpotsLeft, foundingStatus } from "@/lib/founding";
import { listProjects } from "@/lib/projects";
import { FOUNDING_OFFER } from "@/lib/testimonials";
import { logoutAction } from "../../(auth)/actions";
import { claimFoundingAction } from "./actions";

export const metadata = { title: "Founding customer offer" };
export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function FoundingPage({ searchParams }: { searchParams: Promise<{ claimed?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const st = foundingStatus(user.id);
  const left = foundingSpotsLeft();
  const projects = listProjects(user.id);
  const home = projects[0] ? `/app/p/${projects[0].id}` : "/app";
  return (
    <div>
      <nav className="lp-nav">
        <Link href="/app?new=1" className="logo"><span className="logo-mark" aria-hidden>✓</span>ProofMyAI</Link>
        <div className="row"><ThemeToggle /><form action={logoutAction}><button className="btn btn-ghost btn-sm">Log out</button></form></div>
      </nav>
      <main className="content" style={{ margin: "0 auto", maxWidth: 720 }}>
        <p className="sub"><Link href={home}>← Back to dashboard</Link></p>
        <Flash error={sp.error} />
        {st.claimed ? (
          <div className="card founding">
            <div className="founding-icon" aria-hidden>🎉</div>
            <h1 style={{ marginTop: 0 }}>{sp.claimed ? "You're a founding customer!" : "You're a founding customer"}</h1>
            {st.active && st.endsAt ? (
              <p className="lp-lead">Your <strong>Growth plan is active and free until {day(st.endsAt)}</strong>. No card needed and nothing will be charged. We&apos;ll email you a week before it ends; if you don&apos;t subscribe, you simply move to the Free plan and keep all your data.</p>
            ) : (
              <p className="lp-lead">Thank you for being one of our first customers.</p>
            )}
            <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
              <Link href={home} className="btn">📊 Open my dashboard</Link>
              <Link href="/app/feedback" className="btn btn-ghost">⭐ Share feedback</Link>
            </div>
          </div>
        ) : (
          <div className="card founding">
            <div className="founding-icon" aria-hidden>🚀</div>
            <h1 style={{ marginTop: 0 }}>Become a founding customer</h1>
            <p className="lp-lead">Get <strong>{FOUNDING_OFFER.reward}</strong> ({FOUNDING_OFFER.days} days). No card, no automatic charge. In return we ask for {FOUNDING_OFFER.ask}.</p>
            <ul style={{ textAlign: "left", maxWidth: 440, margin: "0 auto 18px" }}>
              <li>📁 3 projects and 3,000 audited conversations a month</li>
              <li>🧪 Nightly tests for 5 bots</li>
              <li>⚙️ Unlimited n8n/Make workflows and AI agents</li>
              <li>📱 Direct WhatsApp access to the developer</li>
            </ul>
            {left > 0 ? (
              <>
                <form action={claimFoundingAction}><SubmitButton pendingText="Activating…">🎉 Claim my founding spot</SubmitButton></form>
                <p className="faint" style={{ marginTop: 10 }}>{left} of {FOUNDING_OFFER.spots} spots left · activates instantly</p>
              </>
            ) : (
              <p className="lp-lead">All founding spots are taken. You can still <Link href="/app/billing">start a 14-day free trial</Link>.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
