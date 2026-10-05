"use server";

import { headers } from "next/headers";
import { rateLimit } from "@/lib/security";
import { captchaConfig, checkCaptcha, type CaptchaConfig } from "@/lib/captcha";
import { currentGaIds, trackEvent } from "@/lib/ga";
import { freeCheck, type FreeCheckResult } from "@/lib/freecheck";

export interface CheckState { result?: FreeCheckResult; error?: string; captcha?: CaptchaConfig }

export async function freeCheckAction(_: CheckState, form: FormData): Promise<CheckState> {
  const fresh = captchaConfig();
  const question = String(form.get("question") ?? "").trim();
  const answer = String(form.get("answer") ?? "").trim();
  const policy = String(form.get("policy") ?? "").trim();
  if (question.length < 3 || answer.length < 3) return { error: "Paste both the customer's question and your bot's answer.", captcha: fresh };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`free-tool:${ip}`, 12, 3600000)) return { error: "You've used the free checker a lot this hour. Create a free account to check every answer automatically.", captcha: fresh };
  const bot = await checkCaptcha(form, ip);
  if (bot) return { error: bot, captcha: fresh };
  try {
    const result = await freeCheck(question, answer, policy);
    void trackEvent(await currentGaIds(), "free_tool_check", { verdict: result.verdict });
    return { result, captcha: fresh };
  } catch (err) {
    console.error("[free-tool] check failed:", err);
    return { error: "Something went wrong while checking. Please try again.", captcha: fresh };
  }
}
