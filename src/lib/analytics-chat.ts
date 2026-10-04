import { NOT_STORED } from "./audit/run";
import { all } from "./db";
import { topicFor } from "./topics";

/**
 * Chatbot analytics for one project over the last N days: volume, accuracy, resolution, escalation,
 * customer satisfaction (from /api/v1/feedback), response times, topics and unanswered questions.
 * Works on every graded reply (uploads and live tracking).
 */
export const RANGES = [7, 30, 90] as const;
const PROBLEM_FLAGS = ["re_ask", "restart", "fallback"];

export interface Kpis {
  conversations: number;
  replies: number;
  repliesPerConversation: number | null;
  accuracy: number | null; // % of replies graded correct
  resolution: number | null; // % of conversations with only correct replies, no re-asks/restarts and no bad rating
  escalation: number | null; // % of conversations where the customer needed a human
  satisfaction: number | null; // % of ratings that were positive
  ratings: number;
  latencyAvg: number | null;
  latencyP95: number | null;
  botCost: number;
}
export interface DayPoint { day: string; conversations: number; replies: number; accuracy: number | null }
export interface TopicRow { topic: string; replies: number; conversations: number; share: number; accuracy: number | null; satisfaction: number | null; ratings: number; problems: number }
export interface Gap { question: string; topic: string; count: number; reason: string }
export interface ChatAnalytics { days: number; kpis: Kpis; previous: Kpis; daily: DayPoint[]; topics: TopicRow[]; gaps: Gap[] }

interface Row { audit_id: number; conversation_id: string; v: string; topic: string | null; source_doc: string | null; question: string; reason: string; conv_flags: string | null; latency_ms: number | null; cost_usd: number | null; at: string }

const sqlTime = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const norm = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function rowsBetween(projectId: number, from: Date, to: Date): Row[] {
  return all<Row>(
    `SELECT i.audit_id, i.conversation_id, COALESCE(i.corrected_verdict, i.verdict) AS v, i.topic, i.source_doc, i.question, i.reason, i.conv_flags,
            i.latency_ms, i.cost_usd, replace(COALESCE(i.created_at, a.created_at), 'T', ' ') AS at
       FROM audit_items i JOIN audits a ON a.id = i.audit_id
      WHERE a.project_id = ? AND replace(COALESCE(i.created_at, a.created_at), 'T', ' ') >= ? AND replace(COALESCE(i.created_at, a.created_at), 'T', ' ') < ?
      ORDER BY i.id LIMIT 60000`,
    projectId, sqlTime(from), sqlTime(to),
  );
}

function feedbackBetween(projectId: number, from: Date, to: Date): { conversation_id: string; value: number }[] {
  return all("SELECT conversation_id, value FROM chat_feedback WHERE project_id = ? AND replace(created_at, 'T', ' ') >= ? AND replace(created_at, 'T', ' ') < ?", projectId, sqlTime(from), sqlTime(to));
}

const topicOf = (r: Row) => r.topic || topicFor(r.question === NOT_STORED ? "" : r.question, r.source_doc);

function kpis(rows: Row[], feedback: { conversation_id: string; value: number }[]): Kpis {
  const convs = new Map<string, { ok: boolean; escalate: boolean; cid: string }>();
  let correct = 0, cost = 0;
  const lat: number[] = [];
  for (const r of rows) {
    const key = `${r.audit_id}:${r.conversation_id}`;
    const c = convs.get(key) ?? { ok: true, escalate: false, cid: r.conversation_id };
    if (r.v === "correct") correct++;
    else c.ok = false;
    if (r.v === "should_escalate") c.escalate = true;
    if (r.conv_flags && r.conv_flags.split(",").some((f) => PROBLEM_FLAGS.includes(f))) c.ok = false;
    convs.set(key, c);
    if (r.latency_ms != null) lat.push(r.latency_ms);
    cost += r.cost_usd ?? 0;
  }
  const unhappy = new Set(feedback.filter((f) => f.value < 0.5).map((f) => f.conversation_id));
  const list = [...convs.values()];
  lat.sort((a, b) => a - b);
  return {
    conversations: list.length,
    replies: rows.length,
    repliesPerConversation: list.length ? Math.round((rows.length / list.length) * 10) / 10 : null,
    accuracy: pct(correct, rows.length),
    resolution: pct(list.filter((c) => c.ok && !unhappy.has(c.cid)).length, list.length),
    escalation: pct(list.filter((c) => c.escalate).length, list.length),
    satisfaction: pct(feedback.filter((f) => f.value >= 0.5).length, feedback.length),
    ratings: feedback.length,
    latencyAvg: lat.length ? Math.round(lat.reduce((s, x) => s + x, 0) / lat.length) : null,
    latencyP95: lat.length ? lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.95) - 1)] : null,
    botCost: Math.round(cost * 100) / 100,
  };
}

export function chatAnalytics(projectId: number, days: number, now = new Date()): ChatAnalytics {
  const start = new Date(now.getTime() - days * 86400000);
  const prevStart = new Date(start.getTime() - days * 86400000);
  const rows = rowsBetween(projectId, start, now);
  const feedback = feedbackBetween(projectId, start, now);

  // Daily volume and accuracy (conversations counted on the day of their first reply).
  const byDay = new Map<string, { convs: Set<string>; replies: number; correct: number }>();
  const firstDay = new Map<string, string>();
  for (const r of rows) {
    const key = `${r.audit_id}:${r.conversation_id}`;
    const day = r.at.slice(0, 10);
    if (!firstDay.has(key)) firstDay.set(key, day);
    const d = byDay.get(day) ?? { convs: new Set(), replies: 0, correct: 0 };
    d.replies++;
    if (r.v === "correct") d.correct++;
    byDay.set(day, d);
  }
  for (const [key, day] of firstDay) byDay.get(day)?.convs.add(key);
  const daily: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
    const d = byDay.get(day);
    daily.push({ day, conversations: d?.convs.size ?? 0, replies: d?.replies ?? 0, accuracy: d ? pct(d.correct, d.replies) : null });
  }

  // Topics: volume, accuracy and satisfaction per topic (a rating counts for the topics of its conversation).
  const convTopics = new Map<string, Set<string>>();
  const t = new Map<string, { replies: number; correct: number; convs: Set<string>; problems: number; up: number; ratings: number }>();
  for (const r of rows) {
    const topic = topicOf(r);
    const row = t.get(topic) ?? { replies: 0, correct: 0, convs: new Set(), problems: 0, up: 0, ratings: 0 };
    row.replies++;
    if (r.v === "correct") row.correct++;
    else row.problems++;
    row.convs.add(`${r.audit_id}:${r.conversation_id}`);
    t.set(topic, row);
    const set = convTopics.get(r.conversation_id) ?? new Set();
    set.add(topic);
    convTopics.set(r.conversation_id, set);
  }
  for (const f of feedback) {
    for (const topic of convTopics.get(f.conversation_id) ?? []) {
      const row = t.get(topic)!;
      row.ratings++;
      if (f.value >= 0.5) row.up++;
    }
  }
  const topics: TopicRow[] = [...t.entries()]
    .map(([topic, r]) => ({ topic, replies: r.replies, conversations: r.convs.size, share: pct(r.replies, rows.length) ?? 0, accuracy: pct(r.correct, r.replies), satisfaction: pct(r.up, r.ratings), ratings: r.ratings, problems: r.problems }))
    .sort((a, b) => b.replies - a.replies);

  // Questions the help docs don't answer.
  const g = new Map<string, Gap>();
  for (const r of rows) {
    if (r.question === NOT_STORED || !r.question.trim()) continue;
    if (!(r.v === "unsupported" || (r.v !== "correct" && !r.source_doc && r.v !== "should_escalate"))) continue;
    const k = norm(r.question);
    const cur = g.get(k);
    if (cur) cur.count++;
    else g.set(k, { question: r.question.slice(0, 300), topic: topicOf(r), count: 1, reason: r.reason.slice(0, 300) });
  }
  const gaps = [...g.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  return {
    days, kpis: kpis(rows, feedback), previous: kpis(rowsBetween(projectId, prevStart, start), feedbackBetween(projectId, prevStart, start)),
    daily, topics, gaps,
  };
}
