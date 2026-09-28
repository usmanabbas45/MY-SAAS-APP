import Link from "next/link";
import { SubmitButton, ThemeToggle } from "@/components/client";
import { Flash } from "@/components/ui";
import { PasswordField } from "@/components/password";
import { activeSessions } from "@/lib/account";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { listProjects } from "@/lib/projects";
import { logoutAction } from "../../(auth)/actions";
import { changePasswordAction, deleteAccountAction, signOutOthersAction } from "./actions";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const created = get<{ created_at: string }>("SELECT created_at FROM users WHERE id = ?", user.id)?.created_at ?? "";
  const projects = listProjects(user.id);
  const sessions = activeSessions(user.id);
  const dpa = get<{ at: string | null; company: string | null }>("SELECT dpa_accepted_at AS at, dpa_company AS company FROM users WHERE id = ?", user.id);

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
        <h1>Your account</h1>
        <Flash {...flash} />

        <div className="card">
          <h2>Profile</h2>
          <div className="grid grid-3">
            <div className="stat"><span className="stat-label">Email</span><strong style={{ wordBreak: "break-all" }}>{user.email}</strong></div>
            <div className="stat"><span className="stat-label">Member since</span><strong>{created.slice(0, 10)}</strong></div>
            <div className="stat"><span className="stat-label">Projects</span><strong>{projects.length}</strong></div>
          </div>
        </div>

        <form action={changePasswordAction} className="card">
          <h2>Change password</h2>
          <PasswordField id="current" name="current" label="Current password" autoComplete="current-password" />
          <div className="grid grid-2">
            <PasswordField id="password" name="password" label="New password" hint="at least 8 characters" autoComplete="new-password" />
            <PasswordField id="confirm" name="confirm" label="Repeat new password" autoComplete="new-password" />
          </div>
          <SubmitButton pendingText="Saving…">Change password</SubmitButton>
        </form>

        <div className="card">
          <h2>Data processing agreement</h2>
          {dpa?.at ? (
            <p className="sub" style={{ margin: 0 }}>✅ Accepted for <strong>{dpa.company}</strong> on {dpa.at.slice(0, 10)}. <Link href="/dpa">View DPA</Link> · <Link href="/security">Trust Center</Link></p>
          ) : (
            <p className="sub" style={{ margin: 0 }}>Processing your customers&apos; conversations under GDPR / UK GDPR? <Link href="/dpa#accept">Accept our DPA online</Link> in one click. Privacy controls for each project are in Settings → Data &amp; privacy.</p>
          )}
        </div>

        <div className="card">
          <h2>Devices</h2>
          <p className="sub">You are signed in on {sessions} device{sessions === 1 ? "" : "s"} (including this one).</p>
          <form action={signOutOthersAction}><SubmitButton className="btn btn-ghost" pendingText="Signing out…">Sign out of all other devices</SubmitButton></form>
        </div>

        <div className="card">
          <h2>Your data</h2>
          <p className="sub">Export audit results as CSV from any audit, and training data from each project&apos;s Settings. Read how we handle data in our <Link href="/privacy">Privacy Policy</Link>.</p>
        </div>

        <form action={deleteAccountAction} className="card" style={{ borderColor: "var(--bad)" }}>
          <h2 style={{ color: "var(--bad)" }}>Delete account</h2>
          <p className="sub">Permanently deletes your account, all {projects.length} project{projects.length === 1 ? "" : "s"} and all their data. This cannot be undone.</p>
          <div className="grid grid-2">
            <PasswordField id="del-password" name="password" label="Your password" autoComplete="current-password" />
            <div className="field">
              <label htmlFor="del-confirm">Type <strong>DELETE</strong> to confirm</label>
              <input id="del-confirm" name="confirm" type="text" required autoComplete="off" />
            </div>
          </div>
          <SubmitButton className="btn btn-danger" pendingText="Deleting…" confirm="Delete your account and all data forever?">Delete my account</SubmitButton>
        </form>
      </main>
    </div>
  );
}
