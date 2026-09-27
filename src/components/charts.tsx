import type { DayPoint } from "@/lib/health";

/** 14-day activity chart: stacked workflow success/error bars with an agent-score line. Pure SVG, no chart library. */
export function ActivityChart({ series }: { series: DayPoint[] }) {
  const W = 640, H = 210, pad = { l: 34, r: 34, t: 12, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const maxRuns = Math.max(4, ...series.map((d) => d.workflowRuns));
  const bw = (iw / series.length) * 0.62;
  const x = (i: number) => pad.l + (iw / series.length) * (i + 0.5);
  const yRuns = (v: number) => pad.t + ih - (v / maxRuns) * ih;
  const yScore = (v: number) => pad.t + ih - (v / 100) * ih;
  const pts = series.map((d, i) => (d.agentAvgScore == null ? null : `${x(i)},${yScore(d.agentAvgScore)}`)).filter(Boolean);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Workflow runs and agent score over the last 14 days">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih * (1 - f)} y2={pad.t + ih * (1 - f)} stroke="var(--border)" strokeDasharray="3 4" />
            <text x={pad.l - 6} y={pad.t + ih * (1 - f) + 3} textAnchor="end">{Math.round(maxRuns * f)}</text>
            <text x={W - pad.r + 6} y={pad.t + ih * (1 - f) + 3}>{Math.round(100 * f)}</text>
          </g>
        ))}
        {series.map((d, i) => {
          const ok = d.workflowRuns - d.workflowErrors;
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${d.workflowRuns} runs, ${d.workflowErrors} errors${d.agentAvgScore != null ? `, agent score ${d.agentAvgScore}` : ""}`}</title>
              <rect x={x(i) - bw / 2} y={yRuns(ok)} width={bw} height={Math.max(0, pad.t + ih - yRuns(ok))} rx={3} fill="var(--brand)" opacity={0.8} />
              <rect x={x(i) - bw / 2} y={yRuns(d.workflowRuns)} width={bw} height={Math.max(0, yRuns(ok) - yRuns(d.workflowRuns))} rx={3} fill="var(--bad)" />
              {i % 2 === 0 ? <text x={x(i)} y={H - 8} textAnchor="middle">{d.day.slice(5)}</text> : null}
            </g>
          );
        })}
        {pts.length > 1 ? <polyline points={pts.join(" ")} fill="none" stroke="var(--ok)" strokeWidth={2.5} strokeLinejoin="round" /> : null}
        {series.map((d, i) => (d.agentAvgScore == null ? null : <circle key={`c${d.day}`} cx={x(i)} cy={yScore(d.agentAvgScore)} r={3.5} fill="var(--ok)" />))}
      </svg>
      <div className="legend" style={{ marginTop: 8 }}>
        <span><i className="swatch" style={{ background: "var(--brand)" }} />Workflow runs OK</span>
        <span><i className="swatch" style={{ background: "var(--bad)" }} />Workflow errors</span>
        <span><i className="swatch" style={{ background: "var(--ok)" }} />Agent score (right axis)</span>
      </div>
    </div>
  );
}

export function Sparkline({ values, color = "var(--brand)", width = 120, height = 32 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const W = width, H = height, max = Math.max(...values, 1), min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - ((v - min) / (max - min || 1)) * (H - 4) - 2}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: "100%", height: "auto" }} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
