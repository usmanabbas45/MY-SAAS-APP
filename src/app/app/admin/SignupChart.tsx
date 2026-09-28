"use client";

import { useState } from "react";

/** Daily sign-ups, one series: thin brand-colored bars with rounded tops and a hover tooltip. */
export function SignupChart({ data }: { data: { day: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 160, pad = { top: 12, bottom: 22, left: 28 };
  const max = Math.max(4, ...data.map((d) => d.count));
  const step = (W - pad.left - 16) / data.length;
  const bw = Math.max(4, step - 4);
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const h = hover === null ? null : data[hover];

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Sign-ups per day, last 30 days: ${data.reduce((s, d) => s + d.count, 0)} in total`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - 16} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--faint)">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + i * step + (step - bw) / 2;
          const top = y(d.count), base = y(0), r = Math.min(4, bw / 2, base - top);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + i * step} y={pad.top} width={step} height={H - pad.top - pad.bottom} fill="transparent" />
              {d.count > 0 ? (
                <path
                  d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`}
                  fill="var(--brand)" opacity={hover === null || hover === i ? 1 : 0.45}
                />
              ) : null}
            </g>
          );
        })}
        {[0, 14, 29].map((i) => (
          <text key={i} x={pad.left + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--faint)">{fmt(data[i].day)}</text>
        ))}
      </svg>
      {h ? (
        <div className="card" style={{ position: "absolute", top: 0, left: `${Math.min(80, ((hover! + 0.5) / data.length) * 100)}%`, padding: "6px 10px", margin: 0, pointerEvents: "none", fontSize: 13 }}>
          <strong>{h.count}</strong> sign-up{h.count === 1 ? "" : "s"}<div className="faint">{fmt(h.day)}</div>
        </div>
      ) : null}
    </div>
  );
}
