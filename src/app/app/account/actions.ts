"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { securityNotice } from "@/lib/securityevents";
import { changePassword, currentPasswordOk, deleteAccount, signOutOtherDevices } from "@/lib/account";
import { rateLimit } from "@/lib/security";
import { confirmSetup, disableTwoFactor, startSetup, twoFactorEnabled } from "@/lib/twofactor";
import { currentSessionHash, endSession, requireUser } from "@/lib/auth";
import { strongPasswordProblem } from "@/lib/breach";

function back(msg: { ok?: string; error?: string }): never {
  redirect(`/app/account?${new URLSearchParams(msg as Record<string, string>)}`);
}

export async function changePasswordAction(form: FormData) {
  const user = await requireUser();
  const next = String(form.get("password") ?? "");
  if (next !== String(form.get("confirm") ?? "")) back({ error: "The two new passwords don't match." });
  const weak = await strongPasswordProblem(next, user.email);
  if (weak) back({ error: weak });
  const error = changePassword(user.id, String(form.get("current") ?? ""), next, await currentSessionHash());
  if (!error) {
    const h = await headers();
    await securityNotice(user.email, "password_changed", h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "", h.get("user-agent") ?? "");
  }
  back(error ? { error } : { ok: "Password changed. You were signed out on all other devices." });
}

export async function signOutOthersAction() {
  const user = await requireUser();
  const n = signOutOtherDevices(user.id, await currentSessionHash());
  back({ ok: n ? `Signed out of ${n} other device${n > 1 ? "s" : ""}.` : "No other devices were signed in." });
}

export async function deleteAccountAction(form: FormData) {
  const user = await requireUser();
  if (String(form.get("confirm") ?? "").trim() !== "DELETE") back({ error: "Type DELETE in capital letters to confirm." });
  const error = deleteAccount(user.id, String(form.get("password") ?? ""));
  if (error) back({ error });
  await endSession();
  redirect("/login?deleted=1");
}

// ---------- Two-factor authentication ----------

async function reqInfo(): Promise<{ ip: string; ua: string }> {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "", ua: h.get("user-agent") ?? "" };
}

export async function startTwoFactorAction() {
  const user = await requireUser();
  if (twoFactorEnabled(user.id)) back({ error: "Two-factor authentication is already on." });
  startSetup(user.id);
  redirect("/app/account?setup2fa=1#twofactor");
}

export interface TwoFactorState { error?: string; codes?: string[] }

export async function confirmTwoFactorAction(_: TwoFactorState, form: FormData): Promise<TwoFactorState> {
  const user = await requireUser();
  if (!rateLimit(`2fa-setup:${user.id}`, 10, 900000)) return { error: "Too many attempts. Wait a few minutes and try again." };
  const codes = confirmSetup(user.id, String(form.get("code") ?? ""));
  if (!codes) return { error: "That code is not right. Check the time on your phone is automatic and try the newest code." };
  const { ip, ua } = await reqInfo();
  await securityNotice(user.email, "2fa_on", ip, ua);
  return { codes };
}

export async function disableTwoFactorAction(form: FormData) {
  const user = await requireUser();
  if (!currentPasswordOk(user.id, String(form.get("password") ?? ""))) back({ error: "Wrong password. Two-factor authentication is still on." });
  disableTwoFactor(user.id);
  const { ip, ua } = await reqInfo();
  await securityNotice(user.email, "2fa_off", ip, ua);
  back({ ok: "Two-factor authentication turned off." });
}
