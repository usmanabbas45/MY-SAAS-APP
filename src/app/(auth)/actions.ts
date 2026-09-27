"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkLogin, createUser, endSession, startSession } from "@/lib/auth";
import { createProject } from "@/lib/projects";
import { rateLimit } from "@/lib/security";

export interface AuthState { error?: string }

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
  await startSession(user.id);
  redirect("/app");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/");
}
