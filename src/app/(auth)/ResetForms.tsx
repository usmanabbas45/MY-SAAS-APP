"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import type { AuthState } from "./actions";
import { AuthShell, PasswordInput } from "./AuthForm";

export function ForgotForm({ action, emailEnabled, support }: {
  action: (s: AuthState, f: FormData) => Promise<AuthState>; emailEnabled: boolean; support: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your account email and we'll send you a link to choose a new password.">
      {!emailEnabled ? (
        <div className="alert alert-warn">Password reset by email is not switched on yet. Email <a href={`mailto:${support}`}>{support}</a> from your account email and we&apos;ll help you.</div>
      ) : null}
      {state.ok ? <div className="alert alert-ok" role="status">{state.ok}</div> : null}
      {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
      <form action={formAction}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <SubmitButton className="btn btn-lg" pendingText="Sending…">Send reset link</SubmitButton>
      </form>
      <p className="sub" style={{ marginTop: 16 }}>Remembered it? <Link href="/login">Back to log in</Link></p>
    </AuthShell>
  );
}

export function ResetForm({ action, token }: { action: (s: AuthState, f: FormData) => Promise<AuthState>; token: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <AuthShell title="Choose a new password" subtitle="After saving, you'll be signed out on all devices and can log in with the new password.">
      {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <PasswordInput autoComplete="new-password" label="New password" hint="at least 8 characters" />
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" label="Repeat new password" />
        <SubmitButton className="btn btn-lg" pendingText="Saving…">Save new password</SubmitButton>
      </form>
    </AuthShell>
  );
}
