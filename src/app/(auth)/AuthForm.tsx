"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import type { AuthState } from "./actions";

export function AuthForm({ mode, action }: { mode: "login" | "signup"; action: (s: AuthState, f: FormData) => Promise<AuthState> }) {
  const [state, formAction] = useActionState(action, {});
  const signup = mode === "signup";
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Link href="/" className="logo"><span className="logo-mark">✓</span>ProofMyAI</Link>
        <h2>{signup ? "Create your free account" : "Welcome back"}</h2>
        <p className="sub">{signup ? "Start checking your AI chatbots, agents and workflows in 5 minutes." : "Log in to your dashboard."}</p>
        {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
        <form action={formAction}>
          {signup ? (
            <div className="field">
              <label htmlFor="company">Company or project name</label>
              <input id="company" name="company" type="text" placeholder="Acme Store" maxLength={100} />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password {signup ? <span className="hint">(at least 8 characters)</span> : null}</label>
            <input id="password" name="password" type="password" required minLength={8} autoComplete={signup ? "new-password" : "current-password"} />
          </div>
          <SubmitButton className="btn btn-lg" pendingText={signup ? "Creating account…" : "Logging in…"}>
            {signup ? "Create account" : "Log in"}
          </SubmitButton>
        </form>
        <p className="sub" style={{ marginTop: 16 }}>
          {signup ? <>Already have an account? <Link href="/login">Log in</Link></> : <>New here? <Link href="/signup">Create a free account</Link></>}
        </p>
      </div>
    </div>
  );
}
