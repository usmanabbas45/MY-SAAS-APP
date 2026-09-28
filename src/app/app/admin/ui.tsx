import Link from "next/link";
import { ThemeToggle } from "@/components/client";
import { logoutAction } from "../../(auth)/actions";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="lp-nav" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="row">
          <Link href="/app/admin" className="logo"><span className="logo-mark" aria-hidden>✓</span>ProofMyAI</Link>
          <span className="badge badge-bad">Admin</span>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Link href="/app" className="sub">← App</Link>
          <ThemeToggle />
          <form action={logoutAction}><button className="btn btn-ghost btn-sm">Log out</button></form>
        </div>
      </nav>
      <main className="content" style={{ margin: "0 auto", maxWidth: 1200 }}>{children}</main>
    </div>
  );
}

/** "3h ago" style time for ISO or SQLite datetimes (stored in UTC). */
export function ago(value: string | null): string {
  if (!value) return "never";
  const t = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

export function PlanBadge({ plan, status, cancelAt, suspended, owner }: { plan: string; status: string | null; cancelAt?: string | null; suspended?: string | null; owner?: boolean }) {
  if (owner) return <span className="badge badge-info">Owner · no limits</span>;
  const paid = ["starter", "growth", "agency"].includes(plan) && ["active", "trialing", "past_due", "comped"].includes(status ?? "");
  const name = paid ? plan[0].toUpperCase() + plan.slice(1) : "Free";
  const extra =
    suspended ? { t: "Suspended", c: "badge-bad" }
    : !paid ? null
    : status === "past_due" ? { t: "Payment failed", c: "badge-bad" }
    : cancelAt ? { t: "Cancelling", c: "badge-warn" }
    : status === "trialing" ? { t: "Trial", c: "badge-brand" }
    : status === "comped" ? { t: "Given free", c: "badge-info" }
    : { t: "Paying", c: "badge-ok" };
  return (
    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <span className={`badge ${paid ? "badge-brand" : ""}`}>{name}</span>
      {extra ? <span className={`badge ${extra.c}`}>{extra.t}</span> : null}
    </span>
  );
}
