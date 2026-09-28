"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

export function SubmitButton({ children, className = "btn", pendingText = "Working…", confirm }: {
  children: React.ReactNode; className?: string; pendingText?: string; confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" className={className} disabled={pending}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {pending ? <><span className="spin" aria-hidden />{pendingText}</> : children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button" className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

/** Refreshes server data every few seconds while something is still running. */
export function AutoRefresh({ active, ms = 3000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    // Never refresh while someone is typing in a form or a form is being submitted:
    // a refresh would wipe their input or cancel the action's redirect (and its message).
    let busyUntil = 0;
    const onSubmit = () => { busyUntil = Date.now() + 30000; };
    document.addEventListener("submit", onSubmit, true);
    const t = setInterval(() => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (Date.now() < busyUntil || typing) return;
      router.refresh();
    }, ms);
    return () => { clearInterval(t); document.removeEventListener("submit", onSubmit, true); };
  }, [active, ms, router]);
  return null;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ap-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch { /* storage unavailable */ }
  }, []);
  const cycle = () => {
    const next = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
    setTheme(next);
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    try {
      if (next === "system") localStorage.removeItem("ap-theme");
      else localStorage.setItem("ap-theme", next);
    } catch { /* storage unavailable */ }
  };
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={cycle} aria-label={`Theme: ${theme}. Click to change`}>
      <span aria-hidden>{theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🖥️"}</span>
      <span className="tt-label">{theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System"}</span>
    </button>
  );
}

export interface NavItem { href: string; label: string; icon: string; badge?: number }

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((it) => {
        const active = path === it.href || (it.href.split("/").length > 4 && path.startsWith(`${it.href}/`));
        return (
          <Link key={it.href} href={it.href} className={`nav-link ${active ? "active" : ""}`}>
            <span className="nav-icon" aria-hidden>{it.icon}</span>
            <span>{it.label}</span>
            {it.badge ? <span className="badge badge-bad" style={{ marginLeft: "auto" }}>{it.badge}</span> : null}
          </Link>
        );
      })}
    </>
  );
}

export function ProjectSwitcher({ projects, current }: { projects: { id: number; name: string }[]; current: number }) {
  const router = useRouter();
  return (
    <div className="project-switch">
      <label htmlFor="proj" className="hint">Project</label>
      <select id="proj" value={current} onChange={(e) => {
        const v = e.target.value;
        router.push(v === "new" ? "/app?new=1" : `/app/p/${v}`);
      }}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="new">+ New project</option>
      </select>
    </div>
  );
}
