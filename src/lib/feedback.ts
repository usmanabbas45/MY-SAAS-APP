import { z } from "zod";
import { run } from "./db";
import { truncate } from "./text";

/**
 * Ratings from the chatbot's own users: thumbs up/down or 1-5 stars on a conversation (or one reply).
 * Stored as a value from 0 (bad) to 1 (good), shown on Analytics as customer satisfaction.
 */
export const FeedbackSchema = z.object({
  conversation_id: z.string().min(1).max(200),
  turn_index: z.number().int().min(0).max(100000).optional(),
  rating: z.union([z.enum(["up", "down", "positive", "negative"]), z.number().min(0).max(5), z.boolean()]),
  comment: z.string().max(2000).optional(),
});
export type FeedbackInput = z.infer<typeof FeedbackSchema>;

/** up/true = 1, down/false = 0; whole numbers 1-5 are stars (1 star = 0, 5 stars = 1); a decimal 0-1 score is used as is. */
export function feedbackValue(r: FeedbackInput["rating"]): number {
  if (typeof r === "boolean") return r ? 1 : 0;
  if (typeof r === "string") return r === "up" || r === "positive" ? 1 : 0;
  if (Number.isInteger(r) && r >= 1) return (Math.min(5, r) - 1) / 4;
  return Math.min(1, Math.max(0, r));
}

export function recordFeedback(projectId: number, f: FeedbackInput): number {
  return run(
    "INSERT INTO chat_feedback (project_id, conversation_id, turn_index, value, comment) VALUES (?, ?, ?, ?, ?)",
    projectId, f.conversation_id, f.turn_index ?? null, feedbackValue(f.rating), f.comment ? truncate(f.comment.trim(), 2000) : null,
  ).lastInsertRowid;
}
