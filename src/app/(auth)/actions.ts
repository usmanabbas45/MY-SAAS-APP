"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkLogin, createUser, endSession, isSuspended, startSession } from "@/lib/auth";
import { requestPasswordReset, resetPassword } from "@/lib/account";
import { createProject } from "@/lib/projects";
import { currentGaIds, rememberGaClient, trackEvent } from "@/lib/ga";
import { strongPasswordProblem } from "@/lib/breach";
import { captchaConfig, checkCaptcha, type CaptchaConfig } from "@/lib/captcha";
import { isDisposableEmail } from "@/lib/disposable";
import { get } from "@/lib/db";
import { recordLogin, securityNotice } from "@/lib/securityevents";
import { pendingLoginToken, readPendingLogin, twoFactorEnabled, verifySecondFactor } from "@/lib/twofactor";
import { rateLimit } from "@/lib/security";

export interface AuthState { error?: string; ok?: string; captcha?: CaptchaConfig; pending?: string; founding?: boolean }

/** Error answer with a fresh CAPTCHA (each challenge works once). */
const fail = (error: string): AuthState => ({ error, captcha: captchaConfig() });

async function userAgent(): Promise<string> {
  return (await headers()).get("user-agent")?.slice(0, 400) ?? "";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function signupAction(_: AuthState, form: FormData): Promise<AuthState> {
  const ip = await clientIp();
  if (!rateLimit(`signup:${ip}`, 10, 3600000)) return fail("Too many sign-ups from your network. Try again later.");
  const bot = await checkCaptcha(form, ip);
  if (bot) return fail(bot);
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  if (isDisposableEmail(email)) return fail("Please sign up with your work or personal email. Temporary email addresses aren't accepted.");
  const weak = await strongPasswordProblem(password, email);
  if (weak) return fail(weak);
  const { user, error } = createUser(email, password);
  if (!user) return fail(error ?? "Could not create the account.");
  const projectId = createProject(user.id, String(form.get("company") ?? "") || "My first project");
  await startSession(user.id);
  await recordLogin(user.id, user.email, await userAgent(), ip);
  const ga = await currentGaIds();
  rememberGaClient(user.id, ga);
  void trackEvent(ga, "sign_up", { method: "email" });
  redirect(form.get("founding") === "1" ? "/app/founding" : `/app/p/${projectId}?welcome=1`);
}

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "");
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}:${email.toLowerCase()}`, 8, 900000)) {
    return fail("Too many attempts. Wait 15 minutes and try again.");
  }
  // Lock the account (from every network) after repeated wrong passwords: stops slow, distributed guessing.
  if (!rateLimit(`login-acct:${email.toLowerCase()}`, 20, 3600000)) {
    return fail("This account is temporarily locked after too many wrong passwords. Try again in an hour, or reset your password.");
  }
  const bot = await checkCaptcha(form, ip);
  if (bot) return fail(bot);
  const user = checkLogin(email, String(form.get("password") ?? ""));
  if (!user) return fail("Wrong email or password.");
  if (isSuspended(user.id)) return fail("This account is suspended. Contact support if you think this is a mistake.");
  if (twoFactorEnabled(user.id)) return { pending: pendingLoginToken(user.id), founding: form.get("founding") === "1" };
  await startSession(user.id);
  await recordLogin(user.id, user.email, await userAgent(), ip);
  redirect(form.get("founding") === "1" ? "/app/founding" : "/app");
}

/** Second login step for accounts with two-factor authentication. */
export async function verifyTwoFactorAction(_: AuthState, form: FormData): Promise<AuthState> {
  const pending = String(form.get("pending") ?? "");
  const userId = readPendingLogin(pending);
  if (!userId) return fail("Your login took too long. Please enter your email and password again.");
  const again = (error: string): AuthState => ({ error, pending, founding: form.get("founding") === "1" });
  if (!rateLimit(`2fa:${userId}`, 6, 900000)) return again("Too many wrong codes. Wait 15 minutes and try again.");
  const r = verifySecondFactor(userId, String(form.get("code") ?? ""));
  if (!r.ok) return again("That code is not right. Enter the 6-digit code from your authenticator app, or a recovery code.");
  const email = get<{ email: string }>("SELECT email FROM users WHERE id = ?", userId)?.email ?? "";
  const ip = await clientIp();
  await startSession(userId);
  await recordLogin(userId, email, await userAgent(), ip);
  if (r.usedRecovery) await securityNotice(email, "recovery_used", ip, await userAgent());
  redirect(form.get("founding") === "1" ? "/app/founding" : "/app");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/");
}

export async function forgotPasswordAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.");
  const ip = await clientIp();
  if (!rateLimit(`forgot:${ip}`, 5, 3600000) || !rateLimit(`forgot:${email}`, 3, 3600000)) {
    return fail("Too many reset requests. Please wait an hour and try again.");
  }
  const bot = await checkCaptcha(form, ip);
  if (bot) return fail(bot);
  try {
    await requestPasswordReset(email, process.env.APP_URL || "");
  } catch (err) {
    console.error("[auth] reset email failed:", err);
    return fail("We couldn't send the email right now. Please try again in a few minutes.");
  }
  // Same answer whether or not the account exists, so emails can't be discovered.
  return { captcha: captchaConfig(), ok: "If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder). The link is valid for 60 minutes." };
}

export async function resetPasswordAction(_: AuthState, form: FormData): Promise<AuthState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  if (!rateLimit(`reset:${await clientIp()}`, 10, 3600000)) return { error: "Too many attempts. Please wait and try again." };
  const weak = await strongPasswordProblem(password);
  if (weak) return { error: weak };
  const result = resetPassword(token, password);
  if (!result.ok) return { error: result.error };
  const email = get<{ email: string }>("SELECT email FROM users WHERE id = ?", result.userId)?.email;
  if (email) await securityNotice(email, "password_changed", await clientIp(), await userAgent());
  redirect("/login?reset=1");
}
