"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import type { TicketState } from "./actions";

export function TicketForm({ action, categories, email, defaultCategory }: {
  action: (s: TicketState, f: FormData) => Promise<TicketState>;
  categories: Record<string, string>;
  email?: string;
  defaultCategory?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  if (state.ok) {
    return (
      <div className="card" role="status" id="ticket">
        <h3 style={{ marginTop: 0 }}>✅ Ticket {state.ok.code} received</h3>
        <p className="sub">We&apos;ll reply by email, usually within one business day. For something urgent, send it on WhatsApp too:</p>
        <div className="row">
          <a className="btn btn-whatsapp" href={state.ok.whatsapp} target="_blank" rel="noopener">💬 Send on WhatsApp</a>
          {state.ok.signedIn ? <Link className="btn btn-ghost" href="/app/support">Track my tickets</Link> : null}
        </div>
      </div>
    );
  }
  return (
    <form action={formAction} className="card" id="ticket">
      {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
      {email ? null : (
        <div className="grid grid-2">
          <div className="field"><label htmlFor="t-name">Your name</label><input id="t-name" name="name" type="text" autoComplete="name" maxLength={100} /></div>
          <div className="field"><label htmlFor="t-email">Email (for our reply)</label><input id="t-email" name="email" type="email" required autoComplete="email" /></div>
        </div>
      )}
      <div className="field">
        <label htmlFor="t-cat">What is it about?</label>
        <select id="t-cat" name="category" defaultValue={defaultCategory ?? "bug"}>
          {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="t-subject">Short title</label><input id="t-subject" name="subject" type="text" required minLength={3} maxLength={150} placeholder="e.g. Live tracking shows no events" /></div>
      <div className="field">
        <label htmlFor="t-msg">Describe the issue <span className="hint">(what you did, what happened, and any error message; please don&apos;t paste passwords or API keys)</span></label>
        <textarea id="t-msg" name="message" required minLength={10} maxLength={5000} rows={6} placeholder={"Steps: I clicked … on the … page\nExpected: …\nWhat happened / error message: …"} />
      </div>
      <div className="field"><label htmlFor="t-page">Page or link where it happened <span className="hint">(optional)</span></label><input id="t-page" name="page" type="text" maxLength={300} placeholder="https://proofmyai.com/app/…" /></div>
      <div aria-hidden style={{ position: "absolute", left: -9999 }}><label htmlFor="t-website">Website</label><input id="t-website" name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
      <SubmitButton pendingText="Sending…">Submit ticket</SubmitButton>
    </form>
  );
}
