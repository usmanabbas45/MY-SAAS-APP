"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/client";
import { confirmTwoFactorAction, type TwoFactorState } from "./actions";

/** Confirms 2FA setup with a code, then shows the recovery codes once. */
export function TwoFactorConfirm() {
  const [state, action] = useActionState<TwoFactorState, FormData>(confirmTwoFactorAction, {});
  const [copied, setCopied] = useState(false);
  if (state.codes) {
    const text = state.codes.join("\n");
    return (
      <div className="alert alert-ok" role="status">
        <strong>✅ Two-factor authentication is on.</strong>
        <p style={{ margin: "8px 0" }}>Save these <strong>recovery codes</strong> somewhere safe (a password manager or printed). Each works once if you lose your phone. <strong>They won&apos;t be shown again.</strong></p>
        <pre className="recovery-codes">{text}</pre>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>{copied ? "Copied ✓" : "Copy codes"}</button>
          <a className="btn btn-ghost btn-sm" href={`data:text/plain;charset=utf-8,${encodeURIComponent(`ProofMyAI recovery codes\n\n${text}\n`)}`} download="proofmyai-recovery-codes.txt">Download .txt</a>
          <a className="btn btn-ghost btn-sm" href="/app/account">Done</a>
        </div>
      </div>
    );
  }
  return (
    <form action={action}>
      {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
      <div className="field">
        <label htmlFor="setup-code">3. Enter the 6-digit code from the app</label>
        <input id="setup-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={8} placeholder="123456" className="otp-input" style={{ maxWidth: 220 }} />
      </div>
      <SubmitButton pendingText="Checking…">Turn on two-factor authentication</SubmitButton>
    </form>
  );
}
