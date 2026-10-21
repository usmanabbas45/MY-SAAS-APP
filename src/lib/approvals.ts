import { createHash } from "node:crypto";
import { z } from "zod";
import { all, get, run } from "./db";
import { raiseIncident } from "./incidents";
import { logLiveEvent } from "./liveevents";
import { notify } from "./notify";
import { safeFetch } from "./security";
import { recordTrace } from "./traces";

type Fetcher = typeof safeFetch;

/**
 * Human-in-the-loop approvals: "automate the draft, never the send". An agent submits the action it is about to
 * take (a refund, an email, a CRM write). Routine, reversible actions go ahead; anything irreversible, new, over
 * the amount limit or committing the company to something waits for one click from a person. Rejected actions
 * stay rejected when the agent retries, and every decision records who decided, when and why.
 */
export const ApprovalSchema = z.object({
  action: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
  details: z.string().max(20000).optional(),
  action_id: z.string().max(200).optional(),
  agent_name: z.string().max(200).optional(),
  category: z.string().max(200).optional(),
  amount: z.number().min(0).max(1e12).optional(),
  currency: z.string().max(10).optional(),
  reversible: z.boolean().optional(),
  require_approval: z.boolean().optional(),
  callback_url: z.string().url().max(2000).optional(),
  expires_in_hours: z.number().min(0.1).max(720).optional(),
  /** Your id for one end-to-end request, shared with /chat-events, /agent-runs, /workflow-runs and /verify. */
  trace_id: z.string().min(1).max(200).optional(),
});
export type ApprovalInput = z.infer<typeof ApprovalSchema>;
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface Approval {
  id: number; project_id: number; external_id: string | null; fingerprint: string; agent_name: string | null;
  action: string; summary: string; details: string | null; category: string | null; amount: number | null; currency: string | null;
  reversible: number | null; status: ApprovalStatus; auto: number; reason: string; commitments: string | null;
  decided_by: string | null; decided_at: string | null; note: string | null; callback_url: string | null;
  created_at: string; expires_at: string; trace_id: string | null;
}

const COMMITMENTS: [RegExp, string][] = [
  [/\b(full |partial )?refund(ed|s)?\b/i, "a refund"],
  [/\b(reimburs\w*|compensat\w*)\b/i, "compensation"],
  [/\bguarantee[ds]?\b/i, "a guarantee"],
  [/\b(free of charge|for free|no charge|waive[ds]?)\b/i, "something free"],
  [/\b\d{1,3} ?% (off|discount)\b|\bdiscount\b/i, "a discount"],
  [/\b(credit(ed)? (to )?(your|the) account|store credit)\b/i, "account credit"],
  [/\bwe(?:'ll| will) (send|ship|deliver|replace|call|fix|refund|credit|cancel)\b/i, "an action on the company's behalf"],
  [/\b(by|before) (tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|end of (the )?(day|week|month))\b/i, "a deadline"],
  [/\bwithin \d+ (business |working )?(hours?|days?)\b/i, "a deadline"],
];

/** Promises in a draft that would commit the company: refunds, discounts, deadlines, guarantees. */
export function findCommitments(text: string): string[] {
  return [...new Set(COMMITMENTS.filter(([re]) => re.test(text)).map(([, label]) => label))];
}

const fingerprintOf = (a: ApprovalInput) =>
  createHash("sha256").update(JSON.stringify([a.action_id ?? null, a.action, a.summary, a.details ?? "", a.category ?? "", a.amount ?? null])).digest("hex");

const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

/** Decides whether an action may run by itself or needs a person, and why. */
export function assess(projectId: number, a: ApprovalInput): { status: "approved" | "pending"; reason: string; commitments: string[] } {
  const commitments = findCommitments(`${a.summary}\n${a.details ?? ""}`);
  const project = get<{ approve_over: number | null }>("SELECT approve_over FROM projects WHERE id = ?", projectId);
  const rule = a.category ? get("SELECT 1 FROM approval_rules WHERE project_id = ? AND category = ? AND action = ?", projectId, norm(a.category), norm(a.action)) : null;
  if (a.require_approval) return { status: "pending", reason: "Your agent asked for a person to approve this.", commitments };
  if (rule) return { status: "approved", reason: `Approved by your rule: always allow "${a.category}" for ${a.action}.`, commitments };
  if (a.reversible === false) return { status: "pending", reason: "This can't be undone, so a person approves it first.", commitments };
  if (a.category && !get("SELECT 1 FROM approvals WHERE project_id = ? AND lower(category) = ? AND lower(action) = ? AND status = 'approved' AND auto = 0", projectId, norm(a.category), norm(a.action))) {
    return { status: "pending", reason: `First time this agent wants to ${a.action} for "${a.category}". Decide once, then make it a rule.`, commitments };
  }
  if (a.amount != null && project?.approve_over != null && a.amount >= project.approve_over) {
    return { status: "pending", reason: `${a.amount} ${a.currency ?? ""} is at or over your approval limit of ${project.approve_over}.`.replace("  ", " "), commitments };
  }
  if (commitments.length) return { status: "pending", reason: `It commits your company to ${commitments.join(", ")}. A person checks the promise is allowed.`, commitments };
  return { status: "approved", reason: "Routine and reversible, so it was approved automatically.", commitments };
}

export async function submitApproval(projectId: number, a: ApprovalInput, now = new Date()): Promise<Approval> {
  const fingerprint = fingerprintOf(a);
  const previous = get<Approval>(
    "SELECT * FROM approvals WHERE project_id = ? AND (fingerprint = ? OR (external_id IS NOT NULL AND external_id = ?)) ORDER BY id DESC LIMIT 1",
    projectId, fingerprint, a.action_id ?? null,
  );
  if (previous && previous.status !== "expired") {
    if (previous.status === "rejected") {
      // The failure mode nobody notices: an agent quietly retrying an action a person already turned down.
      await raiseIncident(projectId, {
        module: "agents", code: "REJECTED_ACTION_RETRIED", severity: "high",
        title: `${a.agent_name ?? "An agent"} tried again to ${a.action} after it was rejected`,
        detail: `"${a.summary}" was rejected${previous.decided_by ? ` by ${previous.decided_by}` : ""}${previous.note ? ` ("${previous.note}")` : ""}. ProofMyAI blocked the retry. Check why the agent keeps trying.`,
        dedupeKey: `approval:${previous.id}:retry`,
      });
    }
    return previous;
  }
  const verdict = assess(projectId, a);
  const expires = new Date(now.getTime() + (a.expires_in_hours ?? 24) * 3600000).toISOString();
  const id = run(
    `INSERT INTO approvals (project_id, external_id, fingerprint, agent_name, action, summary, details, category, amount, currency, reversible, status, auto, reason, commitments, decided_by, decided_at, callback_url, created_at, expires_at, trace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    projectId, a.action_id ?? null, fingerprint, a.agent_name ?? null, a.action, a.summary, a.details ?? null, a.category ?? null, a.amount ?? null, a.currency ?? null,
    a.reversible == null ? null : a.reversible ? 1 : 0, verdict.status, verdict.status === "approved" ? 1 : 0, verdict.reason,
    verdict.commitments.length ? verdict.commitments.join(", ") : null, verdict.status === "approved" ? "ProofMyAI (rule)" : null,
    verdict.status === "approved" ? now.toISOString() : null, a.callback_url ?? null, now.toISOString(), expires, a.trace_id ?? null,
  ).lastInsertRowid;
  recordTrace(projectId, a.trace_id, "approvals", true,
    verdict.status === "pending" ? `Waiting for approval: ${a.action}, ${a.summary}` : `Approved automatically: ${a.action}, ${a.summary}`, verdict.reason, now);
  logLiveEvent(projectId, "agents", verdict.status === "pending" ? "warn" : "ok",
    verdict.status === "pending" ? `Waiting for approval: ${a.action}, ${a.summary}` : `Approved automatically: ${a.action}, ${a.summary}`, verdict.reason, now);
  if (verdict.status === "pending") {
    await notify({
      projectId, kind: "problem", module: "agents", code: "APPROVAL_NEEDED", severity: "high",
      title: `Approve? ${a.agent_name ?? "Your agent"} wants to ${a.action}: ${a.summary}`.slice(0, 200),
      detail: `${verdict.reason}${a.amount != null ? ` Amount: ${a.amount} ${a.currency ?? ""}.` : ""} Approve or reject it on the Approvals page.`,
      link: `/app/p/${projectId}/approvals`,
    }).catch(() => 0);
  }
  return get<Approval>("SELECT * FROM approvals WHERE id = ?", id)!;
}

/** A person's decision. "Always allow" also turns it into a rule for this category and action. */
export async function decideApproval(
  projectId: number, id: number, choice: "approve" | "approve_rule" | "reject", by: string, note: string | null, fetcher: Fetcher = safeFetch, now = new Date(),
): Promise<Approval | null> {
  const a = get<Approval>("SELECT * FROM approvals WHERE id = ? AND project_id = ? AND status = 'pending'", id, projectId);
  if (!a) return null;
  const status = choice === "reject" ? "rejected" : "approved";
  run("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ?", status, by, now.toISOString(), note, id);
  if (choice === "approve_rule" && a.category) {
    run("INSERT OR IGNORE INTO approval_rules (project_id, category, action, created_by) VALUES (?, ?, ?, ?)", projectId, norm(a.category), norm(a.action), by);
  }
  const done = get<Approval>("SELECT * FROM approvals WHERE id = ?", id)!;
  logLiveEvent(projectId, "agents", status === "approved" ? "ok" : "warn", `${status === "approved" ? "Approved" : "Rejected"} by ${by}: ${a.action}, ${a.summary}`, note ?? (choice === "approve_rule" ? `Now approved automatically for "${a.category}".` : ""), now);
  recordTrace(projectId, a.trace_id, "approvals", status === "approved", `${status === "approved" ? "Approved" : "Rejected"} by ${by}: ${a.action}, ${a.summary}`, note ?? "", now);
  if (a.callback_url) {
    fetcher(a.callback_url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action_id: a.external_id, status, decided_by: by, note, decided_at: done.decided_at }),
    }).catch((err: unknown) => console.error("[approvals] callback failed:", err instanceof Error ? err.message : err));
  }
  return done;
}

/** Pending approvals nobody answered in time expire, so a stale "yes" can never be given to an old action. */
export function expireApprovals(now = new Date()): number {
  return run("UPDATE approvals SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?", now.toISOString()).changes;
}

/** Categories a person has approved again and again with no rejections: ready to become automatic. */
export function ruleSuggestions(projectId: number, min = 10): { category: string; action: string; approved: number }[] {
  return all(
    `SELECT category, action, SUM(CASE WHEN status = 'approved' AND auto = 0 THEN 1 ELSE 0 END) AS approved
       FROM approvals a WHERE project_id = ? AND category IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM approval_rules r WHERE r.project_id = a.project_id AND r.category = lower(a.category) AND r.action = lower(a.action))
      GROUP BY lower(category), lower(action)
     HAVING approved >= ? AND SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) = 0
      ORDER BY approved DESC LIMIT 10`,
    projectId, min,
  );
}

export function publicApproval(a: Approval) {
  return {
    id: a.id, action_id: a.external_id, status: a.status, needs_human: a.auto === 0, reason: a.reason,
    commitments: a.commitments ? a.commitments.split(", ") : [], decided_by: a.decided_by, decided_at: a.decided_at, note: a.note, expires_at: a.expires_at,
  };
}
