"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/client";
import type { AuthState } from "./actions";

export function PasswordInput({ id = "password", name = "password", autoComplete, label, hint }: {
  id?: string; name?: string; autoComplete: string; label: string; hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label} {hint ? <span className="hint">({hint})</span> : null}</label>
      <div className="pw-wrap">
        <input id={id} name={name} type={show ? "text" : "password"} required minLength={8} maxLength={200} autoComplete={autoComplete} />
        <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
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

export function AuthForm({ mode, action, notice }: {
  mode: "login" | "signup"; action: (s: AuthState, f: FormData) => Promise<AuthState>; notice?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const signup = mode === "signup";
  return (
    <AuthShell
      title={signup ? "Create your free account" : "Welcome back"}
      subtitle={signup ? "Start checking your AI chatbots, agents and workflows in 5 minutes." : "Log in to your dashboard."}
    >
      {notice ? <div className="alert alert-ok" role="status">{notice}</div> : null}
      {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
      <form action={formAction}>
        {signup ? (
          <div className="field">
            <label htmlFor="company">Company or project name</label>
            <input id="company" name="company" type="text" placeholder="Acme Store" maxLength={100} autoComplete="organization" />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <PasswordInput autoComplete={signup ? "new-password" : "current-password"} label="Password" hint={signup ? "at least 8 characters" : undefined} />
        {!signup ? (
          <p style={{ marginTop: -6, marginBottom: 14, textAlign: "right" }}><Link href="/forgot-password">Forgot password?</Link></p>
        ) : null}
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
        {signup ? <>Already have an account? <Link href="/login">Log in</Link></> : <>New here? <Link href="/signup">Create a free account</Link></>}
      </p>
    </AuthShell>
  );
}
