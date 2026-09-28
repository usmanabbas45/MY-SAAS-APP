"use client";

import { useState } from "react";

/** Password input with a show/hide toggle, for use in server-rendered forms. */
export function PasswordField({ id, name, label, hint, autoComplete }: { id: string; name: string; label: string; hint?: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label} {hint ? <span className="hint">({hint})</span> : null}</label>
      <div className="pw-wrap">
        <input id={id} name={name} type={show ? "text" : "password"} required maxLength={200} autoComplete={autoComplete} />
        <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
      </div>
    </div>
  );
}
