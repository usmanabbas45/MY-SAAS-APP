"use server";

import { redirect } from "next/navigation";
import { changePassword, deleteAccount, signOutOtherDevices } from "@/lib/account";
import { currentSessionHash, endSession, requireUser } from "@/lib/auth";

function back(msg: { ok?: string; error?: string }): never {
  redirect(`/app/account?${new URLSearchParams(msg as Record<string, string>)}`);
}

export async function changePasswordAction(form: FormData) {
  const user = await requireUser();
  const next = String(form.get("password") ?? "");
  if (next !== String(form.get("confirm") ?? "")) back({ error: "The two new passwords don't match." });
  const error = changePassword(user.id, String(form.get("current") ?? ""), next, await currentSessionHash());
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
