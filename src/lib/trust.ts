import { all, get } from "./db";
import type { Severity, Verdict } from "./judge/types";
import { NOT_STORED } from "./audit/run";
import { topicFor } from "./topics";

/**
 * Trust report: where an AI can be left to decide on its own, where it needs a spot check and where a human must
 * approve, backed by measured evidence. Accuracy uses the lower bound of a 95% Wilson interval, so a topic with
 * 19/20 correct is not treated like one with 950/1000: trust is earned with volume, not assumed.
 */
export type Autonomy = "autopilot" | "spot_check" | "human_review" | "not_enough_data";
export type Decision = "allow" | "review" | "block";

export const MIN_EVIDENCE = 20;
export const AUTOPILOT_AT = 0.95;
export const SPOT_CHECK_AT = 0.85;

export interface AreaTrust {
  area: string;
  kind: "topic" | "agent";
  total: number;
  good: number;
  /** Measured share right, 0–100. */
  accuracy: number;
  /** What we can promise with 95% confidence, 0–100. */
  proven: number;
  /** Serious mistakes (made up or off policy, high severity) in the period. */
  serious: number;
  autonomy: Autonomy;
  why: string;
}

export interface TrustReport {
  days: number;
  /** 0–100: the proven accuracy across everything checked, or null with too little evidence. */
  score: number | null;
  answers: number;
  areas: AreaTrust[];
  humanCheck: { reviewed: number; agreed: number; agreement: number | null };
  autopilotShare: number | null;
}

/** Lower bound of the 95% Wilson score interval for k successes out of n. */
export function wilsonLower(k: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - margin) / d);
}

const r1 = (x: number) => Math.round(x * 1000) / 10;

/** Which decisions this area can be trusted with, and the plain-English reason. */
export function autonomyFor(good: number, total: number, serious: number): { autonomy: Autonomy; why: string } {
  if (total < MIN_EVIDENCE) return { autonomy: "not_enough_data", why: `Only ${total} checked so far. ${MIN_EVIDENCE} are needed before ProofMyAI vouches for it.` };
  const proven = wilsonLower(good, total);
  if (serious > 0 && proven < AUTOPILOT_AT) {
    return { autonomy: "human_review", why: `${serious} serious mistake${serious === 1 ? "" : "s"} (made-up or off-policy answers) in this period. Keep a human in the loop until it's fixed.` };
  }
  if (proven >= AUTOPILOT_AT && serious === 0) return { autonomy: "autopilot", why: `Right at least ${r1(proven)}% of the time (95% confidence) with no serious mistakes. Safe to let it decide alone.` };
  if (proven >= SPOT_CHECK_AT) return { autonomy: "spot_check", why: `Right at least ${r1(proven)}% of the time. Let it decide, but review a sample each week.` };
  return { autonomy: "human_review", why: `Proven accuracy is only ${r1(proven)}%. A person should approve its decisions here.` };
}

/** Allow, review or block one answer before it reaches the customer (or before an action runs). */
export function decisionFor(verdict: Verdict, severity: Severity, area: Autonomy | null = null): Decision {
  if ((verdict === "hallucination" || verdict === "off_policy") && severity !== "low") return "block";
  if (verdict === "should_escalate" && severity === "high") return "block";
  if (verdict !== "correct") return "review";
  return area === "human_review" ? "review" : "allow";
}

const sqlTime = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

export function trustReport(projectId: number, days = 30, now = new Date()): TrustReport {
  const since = sqlTime(new Date(now.getTime() - days * 86400000));
  const rows = all<{ v: string; severity: string; topic: string | null; question: string; source_doc: string | null }>(
    `SELECT COALESCE(i.corrected_verdict, i.verdict) AS v, i.severity, i.topic, i.question, i.source_doc
       FROM audit_items i JOIN audits a ON a.id = i.audit_id
      WHERE a.project_id = ? AND replace(COALESCE(i.created_at, a.created_at), 'T', ' ') >= ? LIMIT 100000`,
    projectId, since,
  );
  const byTopic = new Map<string, { good: number; total: number; serious: number }>();
  let good = 0;
  for (const r of rows) {
    const area = r.topic || topicFor(r.question === NOT_STORED ? "" : r.question, r.source_doc);
    const t = byTopic.get(area) ?? { good: 0, total: 0, serious: 0 };
    t.total++;
    if (r.v === "correct") { t.good++; good++; }
    if ((r.v === "hallucination" || r.v === "off_policy") && r.severity === "high") t.serious++;
    byTopic.set(area, t);
  }
  const agents = all<{ agent_name: string; total: number; good: number; serious: number }>(
    `SELECT agent_name, COUNT(*) AS total, SUM(CASE WHEN score >= 80 THEN 1 ELSE 0 END) AS good, SUM(CASE WHEN score < 50 THEN 1 ELSE 0 END) AS serious
       FROM agent_runs WHERE project_id = ? AND replace(created_at, 'T', ' ') >= ? GROUP BY agent_name`,
    projectId, since,
  );
  const area = (name: string, kind: AreaTrust["kind"], t: { good: number; total: number; serious: number }): AreaTrust => ({
    area: name, kind, total: t.total, good: t.good, accuracy: r1(t.good / Math.max(1, t.total)), proven: r1(wilsonLower(t.good, t.total)),
    serious: t.serious, ...autonomyFor(t.good, t.total, t.serious),
  });
  const order: Record<Autonomy, number> = { human_review: 0, spot_check: 1, autopilot: 2, not_enough_data: 3 };
  const areas = [
    ...[...byTopic.entries()].map(([name, t]) => area(name, "topic", t)),
    ...agents.map((a) => area(`AI agent: ${a.agent_name}`, "agent", { good: a.good ?? 0, total: a.total, serious: a.serious ?? 0 })),
  ].sort((a, b) => order[a.autonomy] - order[b.autonomy] || b.total - a.total);

  const fb = get<{ reviewed: number; agreed: number | null }>(
    `SELECT COUNT(*) AS reviewed, SUM(CASE WHEN i.feedback = 'agree' THEN 1 ELSE 0 END) AS agreed
       FROM audit_items i JOIN audits a ON a.id = i.audit_id WHERE a.project_id = ? AND i.feedback IS NOT NULL`,
    projectId,
  );
  const reviewed = fb?.reviewed ?? 0;
  const agreed = fb?.agreed ?? 0;
  const decided = areas.filter((a) => a.autonomy !== "not_enough_data");
  const autopilotVolume = decided.filter((a) => a.autonomy === "autopilot").reduce((s, a) => s + a.total, 0);
  const decidedVolume = decided.reduce((s, a) => s + a.total, 0);
  return {
    days,
    score: rows.length >= MIN_EVIDENCE ? Math.round(wilsonLower(good, rows.length) * 100) : null,
    answers: rows.length,
    areas,
    humanCheck: { reviewed, agreed, agreement: reviewed ? r1(agreed / reviewed) : null },
    autopilotShare: decidedVolume ? Math.round((autopilotVolume / decidedVolume) * 100) : null,
  };
}

/** The autonomy level of the area a question falls into (used by the pre-send check). */
export function areaAutonomy(projectId: number, topic: string, now = new Date()): Autonomy {
  return trustReport(projectId, 30, now).areas.find((a) => a.kind === "topic" && a.area === topic)?.autonomy ?? "not_enough_data";
}
