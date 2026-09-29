"use server";

import { redirect } from "next/navigation";
import { requestPasswordReset } from "@/lib/account";
import { logAdmin, requireAdmin, setPlanManually, setSuspended } from "@/lib/admin";
import type { PlanId } from "@/lib/billing";
import { get, run } from "@/lib/db";
import { getTicket, replyToTicket, setTicketStatus, ticketCode } from "@/lib/support";

async function target(form: FormData) {
  const admin = await requireAdmin();
  const id = Number(form.get("userId"));
  const user = Number.isInteger(id) ? get<{ id: number; email: string; paddle_subscription_id: string | null; plan_status: string | null }>(
    "SELECT id, email, paddle_subscription_id, plan_status FROM users WHERE id = ?", id,
  ) : undefined;
  if (!user) redirect("/app/admin?error=User+not+found");
  return { admin, user, back: (msg: { ok?: string; error?: string }): never => redirect(`/app/admin/users/${user.id}?${new URLSearchParams(msg as Record<string, string>)}`) };
}

export async function setPlanAction(form: FormData) {
  const { admin, user, back } = await target(form);
  const plan = String(form.get("plan")) as PlanId;
  if (!["free", "starter", "growth", "agency", "compliance"].includes(plan)) back({ error: "Unknown plan." });
  setPlanManually(user.id, plan);
  logAdmin(admin.email, "set_plan", user.email, plan === "free" ? "free" : `${plan} (given free)`);
  back({ ok: plan === "free" ? "Moved to the Free plan." : `Gave the ${plan} plan for free. Paddle was not charged.` });
}

export async function suspendAction(form: FormData) {
  const { admin, user, back } = await target(form);
  const suspend = form.get("suspend") === "1";
  if (suspend && user.email === admin.email) back({ error: "You can't suspend your own account." });
  setSuspended(user.id, suspend);
  logAdmin(admin.email, suspend ? "suspend" : "unsuspend", user.email);
  back({ ok: suspend ? "Account suspended: logged out everywhere, login and API blocked." : "Account re-activated." });
}

export async function signOutUserAction(form: FormData) {
  const { admin, user, back } = await target(form);
  run("DELETE FROM sessions WHERE user_id = ?", user.id);
  logAdmin(admin.email, "sign_out", user.email);
  back({ ok: "Signed out of all devices." });
}

export async function sendResetAction(form: FormData) {
  const { admin, user, back } = await target(form);
  await requestPasswordReset(user.email, process.env.APP_URL || "");
  logAdmin(admin.email, "password_reset_email", user.email);
  back({ ok: process.env.RESEND_API_KEY ? `Password reset email sent to ${user.email}.` : "Email is not set up (RESEND_API_KEY missing), so no email was sent." });
}

export async function saveNoteAction(form: FormData) {
  const { admin, user, back } = await target(form);
  run("UPDATE users SET admin_note = ? WHERE id = ?", String(form.get("note") ?? "").trim().slice(0, 2000) || null, user.id);
  logAdmin(admin.email, "note", user.email);
  back({ ok: "Note saved." });
}

export async function deleteUserAction(form: FormData) {
  const { admin, user, back } = await target(form);
  if (user.email === admin.email) back({ error: "You can't delete your own account here. Use Account → Delete account." });
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== user.email) back({ error: "Type the user's email exactly to confirm." });
  run("DELETE FROM users WHERE id = ?", user.id);
  logAdmin(admin.email, "delete_user", user.email, user.paddle_subscription_id ? `had Paddle subscription ${user.paddle_subscription_id} (${user.plan_status})` : "");
  redirect(`/app/admin?ok=${encodeURIComponent(`Deleted ${user.email} and all their data.`)}`);
}

export async function replyTicketAction(form: FormData) {
  const admin = await requireAdmin();
  const id = Number(form.get("ticketId"));
  const reply = String(form.get("reply") ?? "").trim();
  const back = (msg: Record<string, string>): never => redirect(`/app/admin/support?${new URLSearchParams(msg)}#t${id}`);
  if (reply.length < 2) back({ error: "Write a reply first." });
  let emailed = false;
  try {
    emailed = await replyToTicket(id, reply, form.get("close") === "1");
  } catch (err) {
    back({ error: err instanceof Error ? err.message : "Could not save the reply." });
  }
  logAdmin(admin.email, "ticket_reply", getTicket(id)?.email ?? null, ticketCode(id));
  back(emailed ? { ok: `Reply saved and emailed (${ticketCode(id)}).` } : { ok: `Reply saved; the customer sees it under Help & support. Email not sent (check RESEND_API_KEY).` });
}

export async function ticketStatusAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("ticketId"));
  const status = String(form.get("status"));
  if (["open", "answered", "closed"].includes(status)) setTicketStatus(id, status as "open" | "answered" | "closed");
  redirect(`/app/admin/support?ok=${encodeURIComponent(`${ticketCode(id)} marked ${status}.`)}`);
}
