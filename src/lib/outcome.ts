import { z } from "zod";
import { run } from "./db";
import { raiseIncident } from "./incidents";
import { logLiveEvent } from "./liveevents";
import { safeFetch } from "./security";

type Fetcher = typeof safeFetch;

/**
 * Don't take the agent's word for it: after an agent (or a workflow) says it finished, ProofMyAI looks at the system
 * it was supposed to change, such as the CRM record, the order or the saved file, and alerts when the result isn't
 * there. Headers (API keys) are used for the check only and never stored.
 */
export const OutcomeCheckSchema = z.object({
  url: z.string().url().max(2000),
  method: z.enum(["GET", "HEAD"]).default("GET"),
  headers: z.record(z.string(), z.string().max(4000)).optional(),
  expect_status: z.number().int().min(100).max(599).optional(),
  expect_text: z.string().min(1).max(500).optional(),
  delay_seconds: z.number().min(0).max(600).default(10),
});
export type OutcomeCheck = z.infer<typeof OutcomeCheckSchema>;
export interface OutcomeResult { passed: boolean; detail: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function checkOutcome(c: OutcomeCheck, fetcher: Fetcher = safeFetch): Promise<OutcomeResult> {
  let res: Response;
  try {
    res = await fetcher(c.url, { method: c.method, headers: c.headers }, 15000);
  } catch (err) {
    return { passed: false, detail: `Could not reach ${new URL(c.url).host}: ${err instanceof Error ? err.message : "request failed"}.` };
  }
  const statusOk = c.expect_status != null ? res.status === c.expect_status : res.status >= 200 && res.status < 300;
  if (!statusOk) return { passed: false, detail: `${new URL(c.url).host} answered ${res.status}${c.expect_status != null ? ` (expected ${c.expect_status})` : ""}. The record may not exist.` };
  if (c.expect_text && c.method === "GET") {
    const body = (await res.text()).slice(0, 2_000_000);
    if (!body.toLowerCase().includes(c.expect_text.toLowerCase())) return { passed: false, detail: `The response doesn't contain "${c.expect_text}". The change the agent reported isn't there.` };
  }
  return { passed: true, detail: `Confirmed: ${new URL(c.url).host} answered ${res.status}${c.expect_text ? ` and contains "${c.expect_text}"` : ""}.` };
}

/** Checks once, and once more 30 seconds later before alerting (systems can take a moment to save). */
export async function verifyClaim(
  projectId: number, claim: { who: string; what: string; ref: string; agentRunId?: number },
  c: OutcomeCheck, opts: { fetcher?: Fetcher; wait?: (ms: number) => Promise<unknown>; retry?: boolean } = {},
): Promise<OutcomeResult> {
  const wait = opts.wait ?? sleep;
  if (c.delay_seconds) await wait(c.delay_seconds * 1000);
  let r = await checkOutcome(c, opts.fetcher);
  if (!r.passed && opts.retry !== false) {
    await wait(30_000);
    r = await checkOutcome(c, opts.fetcher);
  }
  logLiveEvent(projectId, claim.agentRunId ? "agents" : "workflows", r.passed ? "ok" : "bad", `${r.passed ? "Result confirmed" : "Result not found"}: ${claim.who}`, `${claim.ref}. ${r.detail}`);
  if (claim.agentRunId) run("UPDATE agent_runs SET verified = ?, verify_detail = ? WHERE id = ?", r.passed ? 1 : 0, r.detail, claim.agentRunId);
  if (!r.passed) {
    await raiseIncident(projectId, {
      module: "agents", code: "CLAIMED_NOT_VERIFIED", severity: "high",
      title: `${claim.who} said it finished, but the result isn't there`,
      detail: `${claim.what ? `${claim.what} ` : ""}(${claim.ref}). ${r.detail} Treat the task as not done until it's checked.`,
      dedupeKey: `outcome:${claim.who}:${claim.ref}`,
    });
  }
  return r;
}
