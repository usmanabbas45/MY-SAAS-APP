"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/client";
import { Captcha } from "@/components/captcha";
import { StrengthMeter } from "@/components/password";
import type { CaptchaConfig } from "@/lib/captcha";
import type { AuthState } from "./actions";

export function PasswordInput({ id = "password", name = "password", autoComplete, label, hint, strength = false }: {
  id?: string; name?: string; autoComplete: string; label: string; hint?: string; strength?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { // the form is reset after each submit: clear the meter too
    const form = input.current?.form;
    const clear = () => setValue("");
    form?.addEventListener("reset", clear);
    return () => form?.removeEventListener("reset", clear);
  }, []);
  return (
    <div className="field">
      <label htmlFor={id}>{label} {hint ? <span className="hint">({hint})</span> : null}</label>
      <div className="pw-wrap">
        <input ref={input} id={id} name={name} type={show ? "text" : "password"} required minLength={strength ? 10 : undefined} maxLength={200} autoComplete={autoComplete}
          onChange={strength ? (e) => setValue(e.target.value) : undefined} />
        <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {strength ? <StrengthMeter value={value} /> : null}
    </div>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="card auth-card">
        <Link href="/" className="logo" aria-label="ProofMyAI home"><span className="logo-mark" aria-hidden>✓</span>ProofMyAI</Link>
        <h1 style={{ fontSize: 22 }}>{title}</h1>
        <p className="sub">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

type Action = (s: AuthState, f: FormData) => Promise<AuthState>;

/** Second login step: 6-digit code from the authenticator app, or a recovery code. */
function TwoFactorStep({ action, pending, founding, next }: { action: Action; pending: string; founding?: boolean; next?: string }) {
  const [state, formAction] = useActionState(action, {});
  if (state.captcha) return <div className="alert alert-bad" role="alert">{state.error} <Link href="/login">Log in again</Link></div>;
  return (
    <AuthShell title="Two-factor authentication" subtitle="Open your authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) and enter the 6-digit code for ProofMyAI.">
      {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
      <form action={formAction}>
        <input type="hidden" name="pending" value={state.pending ?? pending} />
        {founding ? <input type="hidden" name="founding" value="1" /> : null}
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div className="field">
          <label htmlFor="code">Authentication code</label>
          <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={20} placeholder="123456" autoFocus className="otp-input" />
        </div>
        <SubmitButton className="btn btn-lg" pendingText="Checking…">Verify and log in</SubmitButton>
      </form>
      <p className="sub" style={{ marginTop: 16 }}>Lost your phone? Enter one of your recovery codes instead, or <Link href="/support">contact support</Link>.</p>
    </AuthShell>
  );
}

export function AuthForm({ mode, action, notice, founding, captcha, twoFactorAction, next, email: presetEmail }: {
  mode: "login" | "signup"; action: Action; notice?: string; founding?: boolean; captcha: CaptchaConfig; twoFactorAction?: Action; next?: string; email?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  // Controlled so a failed attempt (weak password, wrong code...) doesn't wipe what the visitor typed.
  const [email, setEmail] = useState(presetEmail ?? "");
  const [company, setCompany] = useState("");
  const signup = mode === "signup";
  if (state.pending && twoFactorAction) return <TwoFactorStep action={twoFactorAction} pending={state.pending} founding={state.founding} next={state.next} />;
  return (
    <AuthShell
      title={signup ? "Create your free account" : "Welcome back"}
      subtitle={signup ? "Start checking your AI chatbots, agents and workflows in 5 minutes." : "Log in to your dashboard."}
    >
      {notice ? <div className="alert alert-ok" role="status">{notice}</div> : null}
      {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
      {founding ? <div className="alert alert-info" role="status">🎉 {signup ? "Create your account" : "Log in"} to claim your founding-customer spot: the Growth plan free for 3 months.</div> : null}
      <form action={formAction}>
        {founding ? <input type="hidden" name="founding" value="1" /> : null}
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {signup ? (
          <div className="field">
            <label htmlFor="company">Company or project name</label>
            <input id="company" name="company" type="text" placeholder="Acme Store" maxLength={100} autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <PasswordInput autoComplete={signup ? "new-password" : "current-password"} label="Password" hint={signup ? "10+ characters, mix of letters, numbers and symbols" : undefined} strength={signup} />
        {!signup ? (
          <p style={{ marginTop: -6, marginBottom: 14, textAlign: "right" }}><Link href="/forgot-password">Forgot password?</Link></p>
        ) : null}
        <Captcha key={JSON.stringify(state.captcha ?? captcha)} config={state.captcha ?? captcha} />
        <SubmitButton className="btn btn-lg" pendingText={signup ? "Creating account…" : "Logging in…"}>
          {signup ? "Create account" : "Log in"}
        </SubmitButton>
        {signup ? (
          <p className="hint" style={{ marginTop: 12 }}>
            By creating an account you agree to our <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.
          </p>
        ) : null}
      </form>
      <p className="sub" style={{ marginTop: 16 }}>
        {signup ? <>Already have an account? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : founding ? "/login?founding=1" : "/login"}>Log in</Link></> : <>New here? <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : founding ? "/signup?founding=1" : "/signup"}>Create a free account</Link></>}
      </p>
    </AuthShell>
  );
}
