import { json, readIngest } from "@/lib/api";
import { LiveChatSchema, processLiveChat } from "@/lib/audit/live";
import { limitError, projectOwner } from "@/lib/billing";
import { VERDICT_LABELS } from "@/lib/judge/types";

/**
 * Live chatbot monitoring. Send each conversation (full history or just the new question/answer)
 * as it happens. Replies are graded in the background; add ?wait=1 to get the verdicts in the response.
 * Send just `question` (or messages ending with the customer) when a customer writes, so ProofMyAI can
 * alert you if the bot never replies. Optional: latency_ms, cost_usd, error.
 */
export async function POST(req: Request) {
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const parsed = LiveChatSchema.safeParse(r.body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  }
  const hasReply = Boolean(parsed.data.messages || (parsed.data.answer ?? "").trim());
  const over = hasReply ? limitError(projectOwner(r.project.id), "conversations") : null;
  if (over) return json({ error: over }, 402);
  const wait = new URL(req.url).searchParams.get("wait") === "1";
  let result;
  try {
    result = await processLiveChat(r.project, parsed.data, { wait });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Invalid messages" }, 400);
  }
  const { exchanges } = result;
  if (wait) {
    const grades = await result.grades;
    return json({
      graded: grades.length,
      results: grades.map((g, i) => ({ turn_index: exchanges[i].turnIndex, verdict: g.verdict, label: VERDICT_LABELS[g.verdict], severity: g.severity, reason: g.reason })),
    }, 200);
  }
  return json({ accepted: exchanges.length }, 202);
}
