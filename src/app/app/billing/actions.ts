"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { billingState, changePlan, PAID_PLANS, PLANS, portalUrl, setAutoRenew, syncTransaction, type PlanId } from "@/lib/billing";
import { rateLimit } from "@/lib/security";

function back(msg: { ok?: string; error?: string }): never {
  redirect(`/app/billing?${new URLSearchParams(msg as Record<string, string>).toString()}`);
}

/** Called by the checkout button right after Paddle reports a completed payment. */
export async function syncCheckoutAction(transactionId: string): Promise<boolean> {
  const user = await requireUser();
  if (!rateLimit(`billing-sync:${user.id}`, 30, 600000)) return false;
  try {
    return await syncTransaction(user.id, String(transactionId));
  } catch (err) {
    console.error("[billing] sync failed:", err);
    return false;
  }
}

export async function changePlanAction(form: FormData) {
  const user = await requireUser();
  const plan = String(form.get("plan")) as PlanId;
  if (!PAID_PLANS.includes(plan)) back({ error: "Unknown plan." });
  const interval = form.get("interval") === "year" ? "year" : "month";
  let msg: { ok?: string; error?: string };
  try {
    await changePlan(user.id, plan, interval);
    msg = { ok: `You are now on the ${PLANS[plan].name} plan, billed ${interval === "year" ? "yearly" : "monthly"}.` };
  } catch (err) {
    msg = { error: err instanceof Error ? err.message : "Could not change the plan." };
  }
  back(msg);
}

export async function autoRenewAction(form: FormData) {
  const user = await requireUser();
  const on = form.get("on") === "1";
  let msg: { ok?: string; error?: string };
  try {
    await setAutoRenew(user.id, on);
    const s = billingState(user.id);
    const until = (s.cancelAt ?? s.renewsAt ?? "").slice(0, 10);
    msg = on
      ? { ok: `Auto-renew is on. Your plan continues${s.renewsAt ? ` and renews on ${s.renewsAt.slice(0, 10)}` : ""}.` }
      : { ok: `Auto-renew is off. You keep your plan until ${until || "the end of this period"} and won't be charged again.` };
  } catch (err) {
    msg = { error: err instanceof Error ? err.message : "Could not change auto-renew." };
  }
  back(msg);
}

export async function portalAction() {
  const user = await requireUser();
  let url: string;
  try {
    if (!billingState(user.id).customerId) throw new Error("You don't have a subscription yet.");
    url = await portalUrl(user.id);
  } catch (err) {
    back({ error: err instanceof Error ? err.message : "Could not open billing." });
  }
  redirect(url);
}
