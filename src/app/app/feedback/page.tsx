import Link from "next/link";
import { SubmitButton, ThemeToggle } from "@/components/client";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { whatsappLink } from "@/lib/support";
import { logoutAction } from "../../(auth)/actions";
import { feedbackAction } from "./actions";

export const metadata = { title: "Share feedback" };
export const dynamic = "force-dynamic";

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const projects = listProjects(user.id);
  return (
    <div>
      <nav className="lp-nav">
        <Link href="/app?new=1" className="logo"><span className="logo-mark" aria-hidden>✓</span>ProofMyAI</Link>
        <div className="row">
          <ThemeToggle />
          <form action={logoutAction}><button className="btn btn-ghost btn-sm">Log out</button></form>
        </div>
      </nav>
      <main className="content" style={{ margin: "0 auto", maxWidth: 720 }}>
        <p className="sub"><Link href={projects[0] ? `/app/p/${projects[0].id}` : "/app"}>← Back to dashboard</Link></p>
        <h1>Share your feedback</h1>
        {sp.sent ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>🙏 Thank you!</h2>
            <p>Your feedback goes straight to the developer. Honest criticism helps just as much as praise. Something broken or missing? <Link href="/app/support">Open a ticket</Link> or <a href={whatsappLink("Hi! Some feedback on ProofMyAI:")} target="_blank" rel="noopener">message us on WhatsApp</a>.</p>
          </div>
        ) : (
          <>
            <p className="sub">Two minutes, and it helps a lot. We&apos;re a young product and every piece of feedback shapes what we build next. Only if you tick the box can your words appear on proofmyai.com, and we&apos;ll show exactly what you wrote.</p>
            <Flash error={sp.error} />
            <form action={feedbackAction} className="card">
              <fieldset className="field rating-field">
                <legend>How useful is ProofMyAI for you?</legend>
                <div className="rating">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <label key={n}><input type="radio" name="rating" value={n} defaultChecked={n === 5} required /> {"★".repeat(n)}{"☆".repeat(5 - n)}</label>
                  ))}
                </div>
              </fieldset>
              <div className="field">
                <label htmlFor="f-quote">In a sentence or two: what has ProofMyAI done for you?</label>
                <textarea id="f-quote" name="quote" rows={4} required minLength={20} maxLength={600} placeholder="e.g. The first audit showed our bot was quoting old shipping prices. We fixed one article and the complaints stopped." />
              </div>
              <div className="field">
                <label htmlFor="f-result">A concrete result, if you have one <span className="hint">(optional)</span></label>
                <input id="f-result" name="result" type="text" maxLength={160} placeholder="e.g. Found 14 wrong answers in the first audit" />
              </div>
              <div className="grid grid-2">
                <div className="field"><label htmlFor="f-name">Your name</label><input id="f-name" name="name" type="text" required maxLength={80} autoComplete="name" /></div>
                <div className="field"><label htmlFor="f-role">Role <span className="hint">(optional)</span></label><input id="f-role" name="role" type="text" maxLength={80} placeholder="e.g. Founder, Support lead" /></div>
                <div className="field"><label htmlFor="f-company">Company <span className="hint">(optional)</span></label><input id="f-company" name="company" type="text" maxLength={80} autoComplete="organization" /></div>
                <div className="field"><label htmlFor="f-web">Company website <span className="hint">(optional)</span></label><input id="f-web" name="website" type="url" maxLength={200} placeholder="https://" /></div>
              </div>
              <label className="check"><input type="checkbox" name="consent" value="1" /> ProofMyAI may show this feedback with my name, role and company on its website.</label>
              <div style={{ marginTop: 14 }}><SubmitButton pendingText="Sending…">Send feedback</SubmitButton></div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
