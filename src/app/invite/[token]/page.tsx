import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { AuthShell } from "../../(auth)/AuthForm";
import { currentUser, requireUser } from "@/lib/auth";
import { acceptInvite, inviteByToken, ROLE_LABEL } from "@/lib/team";

export const metadata = { title: "Team invitation", robots: { index: false } };
export const dynamic = "force-dynamic";

async function acceptAction(form: FormData) {
  "use server";
  const user = await requireUser();
  const token = String(form.get("token") ?? "");
  const r = acceptInvite(token, user.id, user.email);
  if (!r.ok) redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(r.error)}`);
  redirect(`/app/p/${r.projectId}`);
}

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const inv = inviteByToken(token);
  const user = await currentUser();
  if (!inv || inv.accepted || inv.expired) {
    return (
      <AuthShell title="Invitation not valid" subtitle={inv?.expired ? "This invitation has expired." : "This invitation was already used or doesn't exist."}>
        <p className="sub">Ask the project owner to send you a new invitation from their Team page.</p>
        <Link href={user ? "/app" : "/login"} className="btn">{user ? "Go to your dashboard" : "Log in"}</Link>
      </AuthShell>
    );
  }
  const next = `/invite/${token}`;
  const roleText = inv.role === "editor" ? "an editor (view results and connect tools)" : "a viewer (view results and reports)";
  return (
    <AuthShell title={`Join ${inv.project_name}`} subtitle={`${inv.owner_email} invited ${inv.email} to this ProofMyAI project as ${roleText}.`}>
      {error ? <div className="alert alert-bad" role="alert">{error}</div> : null}
      {user ? (
        user.email.toLowerCase() === inv.email ? (
          <form action={acceptAction}>
            <input type="hidden" name="token" value={token} />
            <SubmitButton className="btn btn-lg" pendingText="Joining…">Accept and open {inv.project_name}</SubmitButton>
            <p className="faint" style={{ marginTop: 12 }}>Role: {ROLE_LABEL[inv.role]}. The owner can change or remove your access at any time.</p>
          </form>
        ) : (
          <div className="alert alert-warn">You&apos;re logged in as <strong>{user.email}</strong>, but this invitation is for <strong>{inv.email}</strong>. Log out, then log in or sign up with {inv.email}.</div>
        )
      ) : (
        <div className="stack">
          <Link href={`/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(inv.email)}`} className="btn btn-lg" style={{ width: "100%" }}>I have an account: log in</Link>
          <Link href={`/signup?next=${encodeURIComponent(next)}&email=${encodeURIComponent(inv.email)}`} className="btn btn-ghost btn-lg" style={{ width: "100%" }}>Create a free account</Link>
          <p className="faint">Use <strong>{inv.email}</strong>. That&apos;s the address the invitation was sent to.</p>
        </div>
      )}
    </AuthShell>
  );
}
