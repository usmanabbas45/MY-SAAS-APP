import { json, readIngest } from "@/lib/api";
import { gradeLiveChat, LiveChatSchema, newExchanges, redactChat } from "@/lib/audit/live";
import { VERDICT_LABELS } from "@/lib/judge/types";

/**
 * Live chatbot monitoring. Send each conversation (full history or just the new question/answer)
 * as it happens. Replies are graded in the background; add ?wait=1 to get the verdicts in the response.
 */
export async function POST(req: Request) {
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const parsed = LiveChatSchema.safeParse(r.body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  }
  let exchanges;
  try {
    exchanges = newExchanges(r.project.id, r.project.redact_pii ? redactChat(parsed.data) : parsed.data);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Invalid messages" }, 400);
  }
  if (new URL(req.url).searchParams.get("wait") === "1") {
    const grades = await gradeLiveChat(r.project.id, exchanges);
    return json({
      graded: grades.length,
      results: grades.map((g, i) => ({ turn_index: exchanges[i].turnIndex, verdict: g.verdict, label: VERDICT_LABELS[g.verdict], severity: g.severity, reason: g.reason })),
    }, 200);
  }
  void gradeLiveChat(r.project.id, exchanges).catch((err) => console.error("[live] grading failed:", err));
  return json({ accepted: exchanges.length }, 202);
}
