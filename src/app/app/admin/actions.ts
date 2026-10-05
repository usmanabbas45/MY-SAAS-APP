"use server";

import { redirect } from "next/navigation";
import { requestPasswordReset } from "@/lib/account";
import { isAdmin, logAdmin, requireAdmin, setPlanManually, setSuspended } from "@/lib/admin";
import { addBlock, removeBlock } from "@/lib/blocklist";
import type { PlanId } from "@/lib/billing";
import { all, get, run } from "@/lib/db";
import { deleteTestimonial, setTestimonialStatus, submitTestimonial, validateTestimonial } from "@/lib/testimonials";
import { runBackup } from "@/lib/backup";
import { getTicket, replyToTicket, setTicketStatus, ticketCode } from "@/lib/support";
import { LEAD_STATUS_LABELS, LEAD_STATUSES, setLeadStatus, type LeadStatus } from "@/lib/leads";

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

export async function testimonialStatusAction(form: FormData) {
  const admin = await requireAdmin();
  const id = Number(form.get("id"));
  const status = String(form.get("status"));
  let problem: string | null = null;
  if (status === "delete") deleteTestimonial(id);
  else if (status === "approved" || status === "hidden" || status === "pending") problem = setTestimonialStatus(id, status);
  logAdmin(admin.email, `testimonial_${status}`, null, `#${id}`);
  redirect(`/app/admin/testimonials?${new URLSearchParams(problem ? { error: problem } : { ok: status === "approved" ? "Published on the homepage." : status === "delete" ? "Deleted." : `Marked ${status}.` })}`);
}

export async function addTestimonialAction(form: FormData) {
  const admin = await requireAdmin();
  const s = (k: string) => String(form.get(k) ?? "");
  const input = { name: s("name"), role: s("role"), company: s("company"), website: s("website"), quote: s("quote"), result: s("result"), rating: Number(form.get("rating")), consent: form.get("consent") === "1" };
  const back = (q: Record<string, string>): never => redirect(`/app/admin/testimonials?${new URLSearchParams(q)}`);
  if (!input.consent) back({ error: "Only add quotes the customer agreed (in writing) to have published." });
  const problem = validateTestimonial(input);
  if (problem) back({ error: problem });
  const id = await submitTestimonial(null, input, "manual");
  setTestimonialStatus(id, "approved");
  logAdmin(admin.email, "testimonial_add", null, input.name);
  back({ ok: "Added and published on the homepage." });
}

const BULK = {
  suspend: "Suspend (block login and API)",
  unsuspend: "Re-activate",
  signout: "Sign out everywhere",
  delete: "Delete account and all data",
  block_delete: "Block email and delete account",
} as const;
export type BulkAction = keyof typeof BULK;

export async function bulkUserAction(form: FormData) {
  const admin = await requireAdmin();
  const action = String(form.get("action")) as BulkAction;
  const back = String(form.get("back") ?? "/app/admin").startsWith("/app/admin") ? String(form.get("back")) : "/app/admin";
  const go = (msg: Record<string, string>): never => redirect(`${back}${back.includes("?") ? "&" : "?"}${new URLSearchParams(msg)}#users`);
  if (!(action in BULK)) go({ error: "Choose an action." });
  const ids = form.getAll("ids").map(Number).filter(Number.isInteger);
  if (!ids.length) go({ error: "Tick at least one user first." });
  if ((action === "delete" || action === "block_delete") && String(form.get("confirm") ?? "").trim() !== "DELETE") {
    go({ error: "To delete accounts, type DELETE in the confirmation box." });
  }
  const users = all<{ id: number; email: string; plan_status: string | null; paddle_subscription_id: string | null }>(
    `SELECT id, email, plan_status, paddle_subscription_id FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids,
  );
  let done = 0;
  const skipped: string[] = [];
  for (const u of users) {
    if (isAdmin(u.email) || u.email === admin.email) { skipped.push(`${u.email} (admin)`); continue; }
    const subscribed = u.paddle_subscription_id && ["active", "trialing", "past_due"].includes(u.plan_status ?? "");
    if ((action === "delete" || action === "block_delete") && subscribed) { skipped.push(`${u.email} (has a Paddle subscription: cancel it in Paddle first)`); continue; }
    if (action === "suspend") setSuspended(u.id, true);
    if (action === "unsuspend") setSuspended(u.id, false);
    if (action === "signout") run("DELETE FROM sessions WHERE user_id = ?", u.id);
    if (action === "block_delete") addBlock(u.email, "Blocked and deleted from admin", admin.email, isAdmin);
    if (action === "delete" || action === "block_delete") run("DELETE FROM users WHERE id = ?", u.id);
    logAdmin(admin.email, `bulk_${action}`, u.email);
    done++;
  }
  go(done ? { ok: `${BULK[action]}: done for ${done} account${done === 1 ? "" : "s"}.${skipped.length ? ` Skipped: ${skipped.join(", ")}.` : ""}` } : { error: `Nothing changed. Skipped: ${skipped.join(", ")}.` });
}

export async function addBlockAction(form: FormData) {
  const admin = await requireAdmin();
  const r = addBlock(String(form.get("pattern") ?? ""), String(form.get("reason") ?? ""), admin.email, isAdmin);
  if (r.error) redirect(`/app/admin/blocklist?error=${encodeURIComponent(r.error)}`);
  logAdmin(admin.email, "block", r.pattern!, r.suspended!.length ? `suspended ${r.suspended!.join(", ")}` : "");
  redirect(`/app/admin/blocklist?ok=${encodeURIComponent(`Blocked ${r.pattern}.${r.suspended!.length ? ` Suspended ${r.suspended!.length} existing account${r.suspended!.length === 1 ? "" : "s"}.` : ""}`)}`);
}

export async function removeBlockAction(form: FormData) {
  const admin = await requireAdmin();
  const pattern = removeBlock(Number(form.get("id")));
  if (pattern) logAdmin(admin.email, "unblock", pattern);
  redirect(`/app/admin/blocklist?ok=${encodeURIComponent(`${pattern ?? "Entry"} can sign up again. Suspended accounts stay suspended until you re-activate them.`)}`);
}

export async function blockUserAction(form: FormData) {
  const { admin, user, back } = await target(form);
  if (isAdmin(user.email)) back({ error: "You can't block an admin account." });
  const r = addBlock(user.email, String(form.get("reason") ?? "Blocked from user page"), admin.email, isAdmin);
  if (r.error) back({ error: r.error });
  logAdmin(admin.email, "block", user.email);
  back({ ok: "Email blocked: the account is suspended and this email can't sign up again." });
}

export async function indexNowAction() {
  const admin = await requireAdmin();
  const { default: sitemap } = await import("@/app/sitemap");
  const { submitToIndexNow } = await import("@/lib/indexnow");
  let msg: Record<string, string>;
  try {
    const r = await submitToIndexNow(sitemap().map((e) => e.url));
    msg = r.ok ? { ok: `Sent ${r.count} pages to Bing and other IndexNow search engines. They usually re-crawl within a day.` } : { error: `IndexNow answered HTTP ${r.status}. Try again later.` };
  } catch (err) {
    msg = { error: `Could not reach IndexNow: ${err instanceof Error ? err.message : "network error"}` };
  }
  logAdmin(admin.email, "indexnow", null, msg.ok ?? msg.error);
  redirect(`/app/admin?${new URLSearchParams(msg)}`);
}

export async function adminDisableTwoFactorAction(form: FormData) {
  const { admin, user, back } = await target(form);
  const { disableTwoFactor } = await import("@/lib/twofactor");
  const { securityNotice } = await import("@/lib/securityevents");
  disableTwoFactor(user.id);
  await securityNotice(user.email, "2fa_off");
  logAdmin(admin.email, "disable_2fa", user.email);
  back({ ok: "Two-factor authentication removed. The customer can log in with their password and turn it on again." });
}

export async function backupNowAction() {
  const admin = await requireAdmin();
  const r = await runBackup(new Date(), { email: true });
  logAdmin(admin.email, "backup_now", null, r.detail);
  redirect(`/app/admin?${new URLSearchParams(r.ok ? { ok: `Backup made (${r.detail}).` } : { error: `Backup failed: ${r.detail}` })}#system`);
}

export async function leadStatusAction(form: FormData) {
  const admin = await requireAdmin();
  const id = Number(form.get("id"));
  const status = String(form.get("status")) as LeadStatus;
  if (Number.isInteger(id) && LEAD_STATUSES.includes(status)) {
    setLeadStatus(id, status);
    logAdmin(admin.email, "lead_status", null, `#${id} ${status}`);
  }
  redirect(`/app/admin/leads?ok=${encodeURIComponent(`Lead marked "${LEAD_STATUS_LABELS[status] ?? status}".`)}`);
}
