import { BENCH_CASES, BENCH_DOCS, BENCH_VERSION } from "@/lib/benchmark/dataset";

/** The public benchmark dataset, so anyone can check the labels and rerun it against any tool. */
export function GET() {
  return Response.json(
    {
      name: "ProofMyAI chatbot answer benchmark",
      version: BENCH_VERSION,
      license: "CC BY 4.0",
      about: "A fictional outdoor shop's help docs and chatbot answers, each labelled with the verdict a careful reviewer would give. Verdicts: correct, unsupported (not in docs), hallucination (made up), should_escalate, off_policy.",
      docs: BENCH_DOCS,
      cases: BENCH_CASES,
    },
    { headers: { "content-disposition": 'inline; filename="proofmyai-benchmark.json"', "cache-control": "public, max-age=3600" } },
  );
}
