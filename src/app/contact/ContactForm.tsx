"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import type { ContactState } from "./actions";

export function ContactForm({ action }: { action: (s: ContactState, f: FormData) => Promise<ContactState> }) {
  const [state, formAction] = useActionState(action, {});
  if (state.ok) return <div className="alert alert-ok" role="status">{state.ok}</div>;
  return (
    <form action={formAction} className="card">
      {state.error ? <div className="alert alert-bad" role="alert">{state.error}</div> : null}
      <div className="grid grid-2">
        <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" type="text" autoComplete="name" maxLength={100} /></div>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
      </div>
      <div className="field"><label htmlFor="message">Message</label><textarea id="message" name="message" required minLength={10} maxLength={5000} placeholder="How can we help?" /></div>
      <div aria-hidden style={{ position: "absolute", left: -9999 }}><label htmlFor="website">Website</label><input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
      <SubmitButton pendingText="Sending…">Send message</SubmitButton>
    </form>
  );
}
