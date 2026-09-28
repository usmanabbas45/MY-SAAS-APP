import { applySubscription, verifyWebhook, type PaddleSubscription } from "@/lib/billing";

/** Paddle notifications: keeps each user's plan in sync with their subscription. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("paddle-signature"), process.env.PADDLE_WEBHOOK_SECRET?.trim() ?? "")) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  let event: { event_type?: string; data?: unknown };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (event.event_type?.startsWith("subscription.") && event.data) {
    const userId = applySubscription(event.data as PaddleSubscription);
    if (!userId) console.warn(`[paddle] ${event.event_type}: no matching user for subscription ${(event.data as PaddleSubscription).id}`);
  }
  return Response.json({ ok: true });
}
