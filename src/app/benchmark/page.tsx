import Link from "next/link";
import { PublicPage } from "@/components/site";
import { BENCH_CASES, BENCH_DOCS, BENCH_VERSION } from "@/lib/benchmark/dataset";
import { hardMetrics, latestBenchmark, runBenchmark, type BenchRun } from "@/lib/benchmark/run";
import { VERDICT_LABELS } from "@/lib/judge/types";

export const metadata = {
  title: "Accuracy benchmark",
  description: "How accurately ProofMyAI catches wrong AI chatbot answers: problems caught, false alarms and verdict accuracy on a public, labelled dataset you can download and rerun.",
  alternates: { canonical: "/benchmark" },
};
export const dynamic = "force-dynamic";

let basicCache: Promise<BenchRun> | null = null;

function Metrics({ r }: { r: BenchRun }) {
  const m = r.metrics;
  const hard = hardMetrics(r);
  return (
    <>
      {r.version !== BENCH_VERSION ? <p className="alert alert-warn">This run used an older dataset version ({r.version}, without the hard cases). A run on the current version ({BENCH_VERSION}) is coming.</p> : null}
      {hard ? <p className="sub"><strong>Hard cases only</strong> ({hard.total}: subtle details, half-right answers, multi-turn contradictions, trick questions): {hard.recall}% of problems caught, {hard.falseAlarmRate}% false alarms, {hard.verdictAccuracy}% exact verdict.</p> : null}
      <div className="grid grid-4" style={{ margin: "12px 0" }}>
        <div className="card stat"><span className="sub">Problems caught</span><strong style={{ fontSize: 28 }}>{m.recall}%</strong><span className="sub">of wrong answers flagged</span></div>
        <div className="card stat"><span className="sub">Flags that were right</span><strong style={{ fontSize: 28 }}>{m.precision}%</strong><span className="sub">precision</span></div>
        <div className="card stat"><span className="sub">False alarms</span><strong style={{ fontSize: 28 }}>{m.falseAlarmRate}%</strong><span className="sub">of correct answers flagged</span></div>
        <div className="card stat"><span className="sub">Exact verdict</span><strong style={{ fontSize: 28 }}>{m.verdictAccuracy}%</strong><span className="sub">same label as the reviewer</span></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Reviewer&apos;s label</th><th>Answers</th><th>Flagged as a problem</th><th>Exact same verdict</th></tr></thead>
          <tbody>
            {Object.entries(m.byExpected).map(([v, b]) => (
              <tr key={v}><td>{VERDICT_LABELS[v as keyof typeof VERDICT_LABELS] ?? v}</td><td>{b.total}</td><td>{v === "correct" ? `${b.flagged} (false alarms)` : `${b.flagged} of ${b.total}`}</td><td>{b.exact}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary className="sub">Show every answer it got wrong ({r.results.filter((x) => (x.expected === "correct") !== (x.got === "correct")).length})</summary>
        <ul>
          {r.results.filter((x) => (x.expected === "correct") !== (x.got === "correct")).map((x) => {
            const bc = BENCH_CASES.find((b) => b.id === x.id);
            return <li key={x.id}><code>{x.id}</code> &ldquo;{bc?.question}&rdquo; → bot: &ldquo;{bc?.answer}&rdquo;. Expected <strong>{VERDICT_LABELS[x.expected]}</strong>, got <strong>{VERDICT_LABELS[x.got]}</strong>.</li>;
          })}
        </ul>
      </details>
    </>
  );
}

export default async function BenchmarkPage() {
  const ai = latestBenchmark("ai");
  basicCache ??= runBenchmark("basic");
  const basic = await basicCache;
  const kinds = BENCH_CASES.reduce<Record<string, number>>((a, b) => ({ ...a, [b.expected]: (a[b.expected] ?? 0) + 1 }), {});
  return (
    <PublicPage title="Accuracy benchmark">
      <p>How often does ProofMyAI catch a wrong AI answer, and how often does it raise a false alarm? We publish the numbers on a labelled dataset that anyone can download and rerun. The dataset is a fictional outdoor shop: {BENCH_DOCS.length} help articles and {BENCH_CASES.length} chatbot answers, each labelled by a person ({Object.entries(kinds).map(([k, n]) => `${n} ${VERDICT_LABELS[k as keyof typeof VERDICT_LABELS].toLowerCase()}`).join(", ")}).</p>

      <h2>🧠 With AI checking (what paying projects use)</h2>
      {ai ? (
        <>
          <p className="sub">Judge: {ai.judge} · dataset version {ai.version} · run {new Date(ai.createdAt.replace(" ", "T") + (ai.createdAt.endsWith("Z") ? "" : "Z")).toUTCString().slice(5, 22)} UTC</p>
          <Metrics r={ai} />
        </>
      ) : (
        <p className="card">The first AI run hasn&apos;t been published yet. The basic-mode result below is computed live on this page.</p>
      )}

      <h2>⚙️ Basic mode (no AI, rules only)</h2>
      <p className="sub">Used when a project switches AI checking off. Computed live on this page every time the server starts. Basic mode can&apos;t understand meaning, so it misses contradictions that use the same words as your docs; add business rules or switch AI checking on for those.</p>
      <Metrics r={basic} />

      <h2>📏 How it&apos;s measured</h2>
      <ul>
        <li><strong>Problems caught</strong> (recall): of the answers a reviewer labelled wrong (made up, not in docs, should escalate, off policy), the share ProofMyAI flagged as any kind of problem.</li>
        <li><strong>Flags that were right</strong> (precision): of everything ProofMyAI flagged, the share that really was a problem.</li>
        <li><strong>False alarms</strong>: correct answers wrongly flagged.</li>
        <li><strong>Exact verdict</strong>: same label as the reviewer, e.g. &ldquo;made up&rdquo; vs &ldquo;not in docs&rdquo;.</li>
        <li>Each answer goes through the same pipeline customers get: the judge plus conversation and safety checks, without any customer rules.</li>
      </ul>

      <h2>⚖️ Limits, honestly</h2>
      <ul>
        <li>The dataset is small ({BENCH_CASES.length} answers) and written by the ProofMyAI team, so it isn&apos;t independent and your own results will differ.</li>
        <li>It covers chatbot answers in English, including a few multi-turn conversations. It doesn&apos;t measure agent, workflow or CRM checks; those are rule-based and covered by our automated tests.</li>
        <li>Download it, check the labels, and rerun it against any tool: <a href="/benchmark/dataset.json" download>dataset.json</a> (version {BENCH_VERSION}).</li>
      </ul>
      <p>Want to measure your own bot? Upload your conversations and mark verdicts right or wrong; your <Link href="/signup">Trust report</Link> shows how often your team agrees with ProofMyAI.</p>
    </PublicPage>
  );
}
