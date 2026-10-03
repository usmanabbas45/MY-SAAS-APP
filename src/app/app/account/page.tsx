import Link from "next/link";
import { SubmitButton, ThemeToggle } from "@/components/client";
import { Flash } from "@/components/ui";
import { VerifyBanner } from "@/components/verify-banner";
import { PasswordField } from "@/components/password";
import { activeSessions } from "@/lib/account";
import { requireUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { listProjects } from "@/lib/projects";
import { logoutAction } from "../../(auth)/actions";
import QRCode from "qrcode";
import { otpauthUrl, pendingSecret, recoveryCodesLeft, twoFactorEnabled } from "@/lib/twofactor";
import { changePasswordAction, deleteAccountAction, disableTwoFactorAction, signOutOthersAction, startTwoFactorAction } from "./actions";
import { TwoFactorConfirm } from "./TwoFactorConfirm";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; setup2fa?: string }> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const created = get<{ created_at: string }>("SELECT created_at FROM users WHERE id = ?", user.id)?.created_at ?? "";
  const projects = listProjects(user.id);
  const sessions = activeSessions(user.id);
  const tfaOn = twoFactorEnabled(user.id);
  const tfaSince = get<{ t: string | null }>("SELECT totp_enabled_at AS t FROM users WHERE id = ?", user.id)?.t;
  const setupSecret = !tfaOn && flash.setup2fa ? pendingSecret(user.id) : null;
  const qrSvg = setupSecret ? await QRCode.toString(otpauthUrl(setupSecret, user.email), { type: "svg", margin: 1, width: 180 }) : "";
  const devices = all<{ label: string; first_seen: string; last_seen: string }>("SELECT label, first_seen, last_seen FROM login_devices WHERE user_id = ? ORDER BY last_seen DESC LIMIT 10", user.id);
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
        <VerifyBanner userId={user.id} email={user.email} />

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
            <PasswordField id="password" name="password" label="New password" hint="10+ characters, mix of letters, numbers and symbols" autoComplete="new-password" strength email={user.email} />
            <PasswordField id="confirm" name="confirm" label="Repeat new password" autoComplete="new-password" />
          </div>
          <SubmitButton pendingText="Saving…">Change password</SubmitButton>
        </form>

        <div className="card" id="twofactor">
          <h2>🛡️ Two-factor authentication {tfaOn ? <span className="badge badge-ok">On</span> : <span className="badge badge-warn">Off</span>}</h2>
          {tfaOn ? (
            <>
              <p className="sub">On since {tfaSince?.slice(0, 10)}. When you log in, you also enter a code from your authenticator app. Recovery codes left: <strong>{recoveryCodesLeft(user.id)}</strong> of 10.</p>
              <form action={disableTwoFactorAction} className="row" style={{ alignItems: "flex-end", gap: 10 }}>
                <div style={{ flex: "1 1 240px" }}><PasswordField id="tfa-password" name="password" label="Your password (to turn it off)" autoComplete="current-password" /></div>
                <SubmitButton className="btn btn-ghost" pendingText="Turning off…" confirm="Turn off two-factor authentication? Your account will be protected by your password only.">Turn off</SubmitButton>
              </form>
            </>
          ) : setupSecret ? (
            <div className="tfa-setup">
              <ol className="sub" style={{ paddingLeft: 18 }}>
                <li>Install <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong> or <strong>Authy</strong> on your phone.</li>
                <li>In the app tap <strong>+</strong> → <strong>Scan a QR code</strong> and scan this:</li>
              </ol>
              <div className="row" style={{ gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                <div style={{ minWidth: 0 }}>
                  <p className="faint" style={{ margin: "0 0 4px" }}>Can&apos;t scan? Enter this key manually (time-based):</p>
                  <code className="tfa-key">{setupSecret.match(/.{1,4}/g)?.join(" ")}</code>
                </div>
              </div>
              <TwoFactorConfirm />
            </div>
          ) : (
            <>
              <p className="sub">Protect your account even if your password is stolen: after your password, you also enter a 6-digit code from an app on your phone. Takes 1 minute to set up.</p>
              <form action={startTwoFactorAction}><SubmitButton pendingText="Preparing…">Turn on two-factor authentication</SubmitButton></form>
            </>
          )}
        </div>

        <div className="card">
          <h2>💻 Devices that signed in</h2>
          {devices.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Device</th><th>First sign-in</th><th>Last active</th></tr></thead>
              <tbody>{devices.map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.first_seen.slice(0, 10)}</td><td>{d.last_seen.slice(0, 16).replace("T", " ")}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="sub">Devices appear here from your next sign-in.</p>}
          <p className="faint">We email you when your account is used on a new device. Don&apos;t recognise one? Change your password and use “Sign out other devices”.</p>
        </div>

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
