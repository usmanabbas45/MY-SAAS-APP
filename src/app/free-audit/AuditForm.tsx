"use client";

import { useActionState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Captcha } from "@/components/captcha";
import type { CaptchaConfig } from "@/lib/captcha";
import type { AuditState } from "./actions";

export function AuditForm({ action, captcha, platforms, utm }: {
  action: (s: AuditState, f: FormData) => Promise<AuditState>; captcha: CaptchaConfig; platforms: string[]; utm: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, {});
  if (state.ok) {
    return (
      <div className="card audit-done" role="status">
        <div className="audit-done-icon" aria-hidden>✅</div>
        <h3>Request received!</h3>
        <p className="sub">We&apos;ll test your chatbot and email your free report within 2 business days.</p>
        <p className="sub">Can&apos;t wait? Run it yourself in 5 minutes: upload a chat export and get every answer checked.</p>
        <Link href="/signup" className="btn btn-shimmer">Start my free account →</Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="card audit-form">
      {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
      <div className="grid grid-2">
        <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" type="text" autoComplete="name" maxLength={100} /></div>
        <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="email" maxLength={200} /></div>
      </div>
      <div className="field"><label htmlFor="site">Website with the chatbot</label><input id="site" name="site" type="text" required inputMode="url" placeholder="yourshop.com" maxLength={300} /></div>
      <div className="field">
        <label htmlFor="platform">What do you use?</label>
        <select id="platform" name="platform" required defaultValue="">
          <option value="" disabled>Choose one</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="message">Anything we should know? <span className="hint">(optional)</span></label><textarea id="message" name="message" maxLength={2000} placeholder="e.g. customers complain the bot gets delivery times wrong" /></div>
      {Object.entries(utm).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Captcha config={state.captcha ?? captcha} />
      <SubmitButton className="btn btn-lg btn-shimmer" pendingText="Sending…">Get my free audit →</SubmitButton>
      <p className="faint" style={{ marginTop: 10 }}>No account needed. We only use your details to send the audit. <Link href="/privacy">Privacy Policy</Link></p>
    </form>
  );
}
