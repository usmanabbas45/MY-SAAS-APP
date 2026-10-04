import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "../AuthForm";
import { signupAction } from "../actions";
import { captchaConfig } from "@/lib/captcha";
import { safeNext } from "@/lib/next-path";
import { cookies } from "next/headers";
import { get } from "@/lib/db";
import { COOKIE as REF_COOKIE, isRefCode } from "@/lib/referrals";

export const metadata = { title: "Sign up", alternates: { canonical: "/signup" } };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ founding?: string; next?: string; email?: string }> }) {
  const { founding, next: rawNext, email } = await searchParams;
  const next = safeNext(rawNext);
  if (await currentUser()) redirect(next ?? (founding ? "/app/founding" : "/app"));
  const ref = (await cookies()).get(REF_COOKIE)?.value;
  const invited = isRefCode(ref) && Boolean(get("SELECT 1 FROM users WHERE ref_code = ?", ref));
  const notice = invited ? "🎁 A friend invited you. When you become a customer, you both get a month free." : undefined;
  return <AuthForm mode="signup" notice={notice} action={signupAction} founding={Boolean(founding)} captcha={captchaConfig()} next={next} email={email?.slice(0, 200)} />;
}
