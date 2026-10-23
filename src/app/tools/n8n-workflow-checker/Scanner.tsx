"use client";

import { useState } from "react";
import Link from "next/link";
import { EXAMPLE_WORKFLOW, MAX_INPUT, parseWorkflows, scanWorkflow, type ScanResult } from "@/lib/n8nscan";

const SEV = { high: { label: "High", tone: "bad", icon: "🔴" }, medium: { label: "Medium", tone: "warn", icon: "🟠" }, low: { label: "Low", tone: "muted", icon: "🟡" } } as const;
const TONE = { Good: "ok", "Needs work": "warn", "At risk": "bad" } as const;
const badgeClass = (tone: string) => (tone === "muted" ? "badge" : `badge badge-${tone}`);
const SITE = "https://proofmyai.com/tools/n8n-workflow-checker";

/** Runs entirely in the browser: the pasted workflow is never sent anywhere. */
export function Scanner() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScanResult[] | null>(null);

  const run = (input = text) => {
    const parsed = parseWorkflows(input);
    if (!parsed.ok) { setError(parsed.error); setResults(null); return; }
    setError(null);
    setResults(parsed.workflows.map(scanWorkflow));
    requestAnimationFrame(() => document.getElementById("scan-results")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const example = () => { setText(EXAMPLE_WORKFLOW); run(EXAMPLE_WORKFLOW); };
  const share = (r: ScanResult) =>
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE)}&text=${encodeURIComponent(`My n8n workflow scored ${r.score}/100 on a free risk scan. Check yours (it runs in your browser, nothing is uploaded):`)}`;

  return (
    <div className="checker">
      <div className="card checker-form">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 className="checker-h">Paste your n8n workflow</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={example}>Try an example</button>
        </div>
        {error ? <div className="alert alert-bad" role="alert">{error}</div> : null}
        <div className="field">
          <label htmlFor="wf">In n8n: open the workflow → click the canvas → <kbd>Ctrl</kbd>+<kbd>A</kbd> → <kbd>Ctrl</kbd>+<kbd>C</kbd>, then paste here. For the full check (error workflow, timezone) use ⋯ → Download and paste the file.</label>
          <textarea id="wf" value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_INPUT} rows={9} spellCheck={false}
            placeholder='{"nodes": [ … ], "connections": { … }}' style={{ fontFamily: "var(--mono, monospace)", fontSize: 13 }} />
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => run()} style={{ width: "100%" }}>Scan my workflow</button>
        <p className="hint" style={{ marginTop: 8 }}>🔒 Runs in your browser. Your workflow is never uploaded or stored, so it's safe even if it contains keys.</p>
      </div>

      {results ? (
        <div id="scan-results" style={{ marginTop: 20 }}>
          {results.map((r, i) => (
            <div key={i} className="card" style={{ marginBottom: 16 }}>
              <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0 }}>{r.name}</h3>
                  <span className="sub">{r.nodeCount} nodes checked · {r.findings.filter((f) => f.severity === "high").length} high, {r.findings.filter((f) => f.severity === "medium").length} medium, {r.findings.filter((f) => f.severity === "low").length} low</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{r.score}<span className="sub" style={{ fontSize: 16 }}>/100</span></div>
                  <span className={badgeClass(TONE[r.grade])}>{r.grade}</span>
                </div>
              </div>

              {r.findings.map((f) => (
                <details key={f.id} className="scan-finding" open={f.severity === "high"}>
                  <summary>
                    <span className={badgeClass(SEV[f.severity].tone)}>{SEV[f.severity].icon} {SEV[f.severity].label}</span> <strong>{f.title}</strong>
                    {f.nodes.length ? <span className="sub"> · {f.nodes.slice(0, 4).join(", ")}{f.nodes.length > 4 ? ` +${f.nodes.length - 4} more` : ""}</span> : null}
                  </summary>
                  <p style={{ margin: "8px 0 4px" }}><strong>Why it matters:</strong> {f.why}</p>
                  <p style={{ margin: 0 }}><strong>How to fix:</strong> {f.fix}</p>
                </details>
              ))}

              {r.passed.length ? <p className="sub" style={{ marginTop: 12 }}>✅ {r.passed.join(" · ")}</p> : null}
              {r.settingsMissing ? <p className="hint">ℹ️ Error workflow and timezone weren&apos;t checked, because copied nodes don&apos;t include workflow settings. Use ⋯ → Download for the full check.</p> : null}

              <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <a className="btn btn-ghost btn-sm" href={share(r)} target="_blank" rel="noopener">Share my score on LinkedIn</a>
              </div>
            </div>
          ))}

          <div className="card" style={{ borderColor: "var(--brand)" }}>
            <h3 style={{ marginTop: 0 }}>This scan checks the design. ProofMyAI watches it run.</h3>
            <p className="sub">A scan can&apos;t see a run that &quot;succeeds&quot; with 0 items at 3am, a key that expires next week or a workflow that quietly stops. ProofMyAI checks every execution of your n8n and Make workflows and sends you a WhatsApp, Slack or email alert within minutes, with what broke and how to fix it.</p>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Link className="btn btn-primary" href="/signup">Watch my workflows free</Link>
              <Link className="btn btn-ghost" href="/solutions/n8n-workflow-monitoring">How it works</Link>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>Free plan · connect n8n in 2 minutes with a read-only API key · no card needed</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
