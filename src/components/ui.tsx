import type { ReactNode } from "react";
import { VERDICT_LABELS, type Verdict } from "@/lib/judge/types";

export function scoreTone(score: number | null): "ok" | "warn" | "bad" | "muted" {
  if (score == null) return "muted";
  if (score >= 85) return "ok";
  if (score >= 65) return "warn";
  return "bad";
}

const TONE_VAR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", muted: "var(--faint)" } as const;

export function ScoreRing({ score, size = 132, label = "AI Health" }: { score: number | null; size?: number; label?: string }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = TONE_VAR[scoreTone(score)];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${score ?? "not available"}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={12} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="48%" textAnchor="middle" fontSize={size / 4} fontWeight={800} fill="var(--text)">{score ?? "–"}</text>
      <text x="50%" y="66%" textAnchor="middle" fontSize={11} fill="var(--faint)">{label}</text>
    </svg>
  );
}

export function Badge({ tone = "muted", children }: { tone?: "ok" | "warn" | "bad" | "info" | "brand" | "muted"; children: ReactNode }) {
  return <span className={`badge ${tone === "muted" ? "" : `badge-${tone}`}`}>{children}</span>;
}

export function ScoreBadge({ score }: { score: number | null }) {
  const tone = scoreTone(score);
  return <Badge tone={tone === "muted" ? "muted" : tone}>{score == null ? "No data" : `${Math.round(score)}/100`}</Badge>;
}

const VERDICT_TONE: Record<Verdict, "ok" | "warn" | "bad" | "info"> = {
  correct: "ok", unsupported: "warn", hallucination: "bad", should_escalate: "bad", off_policy: "bad", unclear: "info",
};
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge tone={VERDICT_TONE[verdict]}>{VERDICT_LABELS[verdict]}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone = severity === "high" ? "bad" : severity === "medium" ? "warn" : severity === "low" ? "info" : "muted";
  return <Badge tone={tone}><span className="dot" />{severity}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ["success", "done", "passed"].includes(status) ? "ok"
    : ["error", "failed", "timeout", "crashed"].includes(status) ? "bad"
    : ["warning", "running", "cancelled"].includes(status) ? "warn" : "muted";
  return <Badge tone={tone}>{status}</Badge>;
}

export function Stat({ label, value, foot }: { label: string; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {foot ? <span className="stat-foot">{foot}</span> : null}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      {children ? <div className="sub">{children}</div> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="row between" style={{ marginBottom: 20, alignItems: "flex-end" }}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="sub" style={{ margin: 0 }}>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <div className="alert alert-bad" role="alert">{error}</div>;
  if (ok) return <div className="alert alert-ok" role="status">{ok}</div>;
  return null;
}

export function HBars({ rows }: { rows: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div className="hbar" key={r.label}>
          <span className="sub">{r.label}</span>
          <div className="hbar-track"><span style={{ width: `${(r.value / max) * 100}%`, background: r.color }} /></div>
          <strong style={{ textAlign: "right" }}>{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (!Number.isFinite(t)) return iso;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
