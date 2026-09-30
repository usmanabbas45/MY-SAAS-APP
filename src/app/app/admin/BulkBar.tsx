"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

const ACTIONS = [
  ["suspend", "🚫 Suspend (block login + API)"],
  ["unsuspend", "✅ Re-activate"],
  ["signout", "🔒 Sign out everywhere"],
  ["delete", "🗑️ Delete account + all data"],
  ["block_delete", "⛔ Block email + delete account"],
] as const;

function Apply({ count, action }: { count: number; action: string }) {
  const { pending } = useFormStatus();
  const destructive = action === "delete" || action === "block_delete";
  return (
    <button
      className={`btn btn-sm ${destructive ? "btn-danger" : ""}`}
      disabled={pending || !count || !action}
      onClick={(e) => {
        const label = ACTIONS.find(([k]) => k === action)?.[1] ?? action;
        if (!window.confirm(`${label} for ${count} account${count === 1 ? "" : "s"}?`)) e.preventDefault();
      }}
    >
      {pending ? "Working…" : `Apply to ${count} selected`}
    </button>
  );
}

/** Bulk actions for the admin user table: select-all, action picker and DELETE confirmation. */
export function BulkBar() {
  const [count, setCount] = useState(0);
  const [action, setAction] = useState("");
  useEffect(() => {
    const form = document.getElementById("bulk") as HTMLFormElement | null;
    if (!form) return;
    const boxes = () => Array.from(form.querySelectorAll<HTMLInputElement>('input[name="ids"]:not(:disabled)'));
    const update = () => setCount(boxes().filter((b) => b.checked).length);
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.matches("[data-select-all]")) boxes().forEach((b) => (b.checked = t.checked));
      update();
    };
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, []);
  const destructive = action === "delete" || action === "block_delete";
  return (
    <div className={`bulk-bar ${count ? "active" : ""}`}>
      <strong>{count ? `${count} selected` : "Tick users to act on several at once"}</strong>
      <select name="action" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Bulk action" disabled={!count}>
        <option value="">Choose action…</option>
        {ACTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {destructive ? <input name="confirm" placeholder="Type DELETE" aria-label="Type DELETE to confirm" autoComplete="off" style={{ width: 130 }} /> : null}
      <Apply count={count} action={action} />
      {destructive ? <span className="faint">Paying customers are skipped: cancel them in Paddle first.</span> : null}
    </div>
  );
}
