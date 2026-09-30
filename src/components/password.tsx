"use client";

import { useEffect, useRef, useState } from "react";
import { checkPassword } from "@/lib/password";

/** Live strength meter and checklist for a new password. */
export function StrengthMeter({ value, emailFieldId = "email", email }: { value: string; emailFieldId?: string; email?: string }) {
  if (!value) return null;
  const mail = email ?? ((typeof document !== "undefined" ? (document.getElementById(emailFieldId) as HTMLInputElement | null)?.value : "") || "");
  const c = checkPassword(value, mail);
  return (
    <div className="pw-meter" aria-live="polite">
      <div className="pw-bars" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className={i < Math.max(1, c.score) ? `on s${c.score}` : ""} />)}</div>
      <div className={`pw-label s${c.score}`}>{c.label}</div>
      <ul className="pw-rules">
        {c.rules.map((r) => <li key={r.id} className={r.ok ? "ok" : ""}>{r.ok ? "✓" : "○"} {r.text}</li>)}
      </ul>
    </div>
  );
}

/** Password input with a show/hide toggle, and an optional strength meter for new passwords. */
export function PasswordField({ id, name, label, hint, autoComplete, strength = false, email }: {
  id: string; name: string; label: string; hint?: string; autoComplete: string; strength?: boolean; email?: string;
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
        <input ref={input} id={id} name={name} type={show ? "text" : "password"} required maxLength={200} autoComplete={autoComplete}
          minLength={strength ? 10 : undefined} onChange={strength ? (e) => setValue(e.target.value) : undefined} />
        <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
      </div>
      {strength ? <StrengthMeter value={value} email={email} /> : null}
    </div>
  );
}
