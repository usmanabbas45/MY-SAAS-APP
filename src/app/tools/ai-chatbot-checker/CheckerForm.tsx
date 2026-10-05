"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Captcha } from "@/components/captcha";
import type { CaptchaConfig } from "@/lib/captcha";
import type { CheckState } from "./actions";

const EXAMPLE = {
  question: "Do you ship to Germany, and how much is it?",
  answer: "Yes! Shipping to Germany is free on all orders and arrives in 2 days 🚚",
  policy: "Shipping: we ship to the UK, Ireland, France and Germany. EU delivery costs €9.90 and takes 4–6 working days. Orders over €100 ship free.",
};

const TONE: Record<string, string> = { correct: "ok", unsupported: "warn", unclear: "warn", hallucination: "bad", should_escalate: "bad", off_policy: "bad" };

export function CheckerForm({ action, captcha, limits }: {
  action: (s: CheckState, f: FormData) => Promise<CheckState>; captcha: CaptchaConfig; limits: { question: number; answer: number; policy: number };
}) {
  const [state, formAction] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const fill = () => {
    const f = form.current;
    if (!f) return;
    (f.elements.namedItem("question") as HTMLTextAreaElement).value = EXAMPLE.question;
    (f.elements.namedItem("answer") as HTMLTextAreaElement).value = EXAMPLE.answer;
    (f.elements.namedItem("policy") as HTMLTextAreaElement).value = EXAMPLE.policy;
  };
  const r = state.result;
  return (
    <div className="checker">
      <form ref={form} action={formAction} className="card checker-form">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 className="checker-h">Check one answer</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={fill}>Fill an example</button>
        </div>
        {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
        <div className="field"><label htmlFor="question">💬 Customer&apos;s question</label><textarea id="question" name="question" required maxLength={limits.question} rows={2} placeholder="e.g. Can I return a sale item?" /></div>
        <div className="field"><label htmlFor="answer">🤖 Your chatbot&apos;s answer</label><textarea id="answer" name="answer" required maxLength={limits.answer} rows={3} placeholder="Paste exactly what the bot replied" /></div>
        <div className="field"><label htmlFor="policy">📄 Your policy or help article <span className="hint">(the truth to check against)</span></label><textarea id="policy" name="policy" maxLength={limits.policy} rows={5} placeholder="Paste the part of your help docs, FAQ or policy that covers this question" /></div>
        <Captcha config={state.captcha ?? captcha} />
        <SubmitButton className="btn btn-lg btn-shimmer" pendingText="Checking…">Check this answer →</SubmitButton>
        <p className="faint" style={{ marginTop: 10 }}>Free, no sign-up. Nothing you paste is stored.</p>
      </form>

      <div className={`card checker-result ${r ? `tone-${TONE[r.verdict] ?? "warn"}` : "empty"}`} aria-live="polite">
        {r ? (
          <>
            <span className="checker-verdict">{r.verdict === "correct" ? "✓" : "✕"} {r.label}</span>
            {r.severity !== "none" ? <span className={`badge ${r.severity === "high" ? "badge-bad" : "badge-warn"}`} style={{ marginLeft: 8 }}>{r.severity} risk</span> : null}
            <p className="checker-reason">{r.reason}</p>
            {r.flags.length ? <ul className="checker-flags">{r.flags.map((f) => <li key={f}>⚠️ {f}</li>)}</ul> : null}
            <p className="faint">{r.mode === "ai" ? "Checked by the ProofMyAI AI judge." : "Checked with ProofMyAI's basic rules. Your account uses the full AI judge."}</p>
            <div className="checker-cta">
              <strong>Your bot answers hundreds of questions a day.</strong>
              <p className="sub">ProofMyAI checks every one of them automatically and alerts you the moment one goes wrong.</p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <Link href="/signup?utm_source=free_tool" className="btn btn-shimmer">Check every answer free →</Link>
                <Link href="/free-audit?utm_source=free_tool" className="btn btn-ghost">Get a done-for-you audit</Link>
              </div>
            </div>
          </>
        ) : (
          <div className="checker-empty">
            <div className="checker-empty-icon" aria-hidden>🔍</div>
            <p><strong>Your result appears here.</strong></p>
            <p className="sub">We&apos;ll tell you if the answer is correct, made up, not backed by your policy, or should have been handed to a human, and why.</p>
          </div>
        )}
      </div>
    </div>
  );
}
