"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkLogin, createUser, endSession, isSuspended, startSession } from "@/lib/auth";
import { requestPasswordReset, resetPassword } from "@/lib/account";
import { createProject } from "@/lib/projects";
import { rateLimit } from "@/lib/security";

export interface AuthState { error?: string; ok?: string }

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function signupAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!rateLimit(`signup:${await clientIp()}`, 10, 3600000)) return { error: "Too many sign-ups from your network. Try again later." };
  const { user, error } = createUser(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!user) return { error };
  const projectId = createProject(user.id, String(form.get("company") ?? "") || "My first project");
  await startSession(user.id);
  redirect(`/app/p/${projectId}?welcome=1`);
}

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "");
  if (!rateLimit(`login:${await clientIp()}:${email.toLowerCase()}`, 8, 900000)) {
    return { error: "Too many attempts. Wait 15 minutes and try again." };
  }
  const user = checkLogin(email, String(form.get("password") ?? ""));
  if (!user) return { error: "Wrong email or password." };
  if (isSuspended(user.id)) return { error: "This account is suspended. Contact support if you think this is a mistake." };
  await startSession(user.id);
  redirect("/app");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/");
}

export async function forgotPasswordAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (!rateLimit(`forgot:${await clientIp()}`, 5, 3600000) || !rateLimit(`forgot:${email}`, 3, 3600000)) {
    return { error: "Too many reset requests. Please wait an hour and try again." };
  }
  try {
    await requestPasswordReset(email, process.env.APP_URL || "");
  } catch (err) {
    console.error("[auth] reset email failed:", err);
    return { error: "We couldn't send the email right now. Please try again in a few minutes." };
  }
  // Same answer whether or not the account exists, so emails can't be discovered.
  return { ok: "If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder). The link is valid for 60 minutes." };
}

export async function resetPasswordAction(_: AuthState, form: FormData): Promise<AuthState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  if (!rateLimit(`reset:${await clientIp()}`, 10, 3600000)) return { error: "Too many attempts. Please wait and try again." };
  const result = resetPassword(token, password);
  if (!result.ok) return { error: result.error };
  redirect("/login?reset=1");
}
