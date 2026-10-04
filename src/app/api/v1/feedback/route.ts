import { json, readIngest } from "@/lib/api";
import { FeedbackSchema, recordFeedback } from "@/lib/feedback";

/**
 * Customer feedback from your chatbot: send it when a user clicks 👍/👎 or gives a star rating.
 * Body: { "conversation_id": "abc", "rating": "up" | "down" | 1-5 stars | 0.0-1.0 score, "turn_index"?: 3, "comment"?: "..." }
 * Use the same conversation_id you send to /api/v1/chat-events.
 */
export async function POST(req: Request) {
  const r = await readIngest(req);
  if (r instanceof Response) return r;
  const parsed = FeedbackSchema.safeParse(r.body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  }
  const id = recordFeedback(r.project.id, parsed.data);
  return json({ ok: true, id }, 201);
}
