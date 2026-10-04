import type { DayPoint } from "@/lib/analytics-chat";

/**
 * Server-rendered SVG charts for chatbot analytics. One measure per chart (no dual axes), one brand hue,
 * recessive grid, 4px rounded bar tops on the baseline, 2px line, hover tooltips via <title> on wide hit areas,
 * and a direct label only on the latest value.
 */
const W = 640, H = 200, PAD = { l: 36, r: 14, t: 14, b: 26 };
const IW = W - PAD.l - PAD.r, IH = H - PAD.t - PAD.b;
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / (p / 2)) * (p / 2);
}

function xLabels(points: DayPoint[]): number[] {
  const n = points.length;
  const step = n <= 7 ? 1 : n <= 31 ? 7 : 15;
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

export function ConversationsChart({ points }: { points: DayPoint[] }) {
  const max = niceMax(Math.max(...points.map((p) => p.conversations)));
  const slot = IW / points.length;
  const bw = Math.max(2, Math.min(22, slot - 2));
  const y = (v: number) => PAD.t + IH - (v / max) * IH;
  const last = points.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="an-chart" role="img" aria-label={`Conversations per day, last ${points.length} days`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} className="an-grid" />
          <text x={PAD.l - 6} y={y(max * f) + 4} className="an-axis" textAnchor="end">{Math.round(max * f)}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const x = PAD.l + slot * i + (slot - bw) / 2;
        const h = (p.conversations / max) * IH;
        const r = Math.min(4, bw / 2, h);
        return (
          <g key={p.day} className="an-hit">
            <title>{`${fmtDay(p.day)}: ${p.conversations} conversation${p.conversations === 1 ? "" : "s"}, ${p.replies} replies`}</title>
            <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={IH} fill="transparent" />
            {h > 0 ? <path className="an-bar" d={`M${x},${PAD.t + IH} V${PAD.t + IH - h + r} Q${x},${PAD.t + IH - h} ${x + r},${PAD.t + IH - h} H${x + bw - r} Q${x + bw},${PAD.t + IH - h} ${x + bw},${PAD.t + IH - h + r} V${PAD.t + IH} Z`} /> : null}
          </g>
        );
      })}
      {points[last].conversations ? <text x={PAD.l + slot * last + slot / 2} y={y(points[last].conversations) - 6} className="an-label" textAnchor="middle">{points[last].conversations}</text> : null}
      {xLabels(points).map((i) => <text key={i} x={PAD.l + slot * i + slot / 2} y={H - 8} className="an-axis" textAnchor="middle">{fmtDay(points[i].day)}</text>)}
    </svg>
  );
}

export function AccuracyChart({ points }: { points: DayPoint[] }) {
  const slot = IW / points.length;
  const cx = (i: number) => PAD.l + slot * i + slot / 2;
  const y = (v: number) => PAD.t + IH - (v / 100) * IH;
  // Break the line on days without replies instead of drawing through them.
  const segs: string[] = [];
  let cur = "";
  points.forEach((p, i) => {
    if (p.accuracy == null) { if (cur) segs.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${cx(i).toFixed(1)},${y(p.accuracy).toFixed(1)} `;
  });
  if (cur) segs.push(cur);
  const lastIdx = [...points.keys()].reverse().find((i) => points[i].accuracy != null);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="an-chart" role="img" aria-label={`Answer accuracy per day, last ${points.length} days`}>
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="an-grid" />
          <text x={PAD.l - 6} y={y(v) + 4} className="an-axis" textAnchor="end">{v}%</text>
        </g>
      ))}
      {segs.map((d, i) => <path key={i} d={d} className="an-line" />)}
      {points.map((p, i) => p.accuracy == null ? null : (
        <g key={p.day} className="an-hit">
          <title>{`${fmtDay(p.day)}: ${p.accuracy}% of ${p.replies} replies correct`}</title>
          <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={IH} fill="transparent" />
          <circle cx={cx(i)} cy={y(p.accuracy)} r={points.length > 31 ? 2.5 : 4} className="an-dot" />
        </g>
      ))}
      {lastIdx != null ? <text x={Math.min(cx(lastIdx), W - PAD.r - 16)} y={y(points[lastIdx].accuracy!) - 10} className="an-label" textAnchor="middle">{points[lastIdx].accuracy}%</text> : null}
      {xLabels(points).map((i) => <text key={i} x={cx(i)} y={H - 8} className="an-axis" textAnchor="middle">{fmtDay(points[i].day)}</text>)}
    </svg>
  );
}
