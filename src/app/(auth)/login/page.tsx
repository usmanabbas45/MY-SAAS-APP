import { safeNext } from "@/lib/next-path";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "../AuthForm";
import { loginAction, verifyTwoFactorAction } from "../actions";
import { captchaConfig } from "@/lib/captcha";

export const metadata = { title: "Log in", robots: { index: false, follow: true } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string; deleted?: string; founding?: string; next?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await currentUser()) redirect(next ?? (sp.founding ? "/app/founding" : "/app"));
  const notice = sp.reset ? "Your password was changed. Log in with your new password." : sp.deleted ? "Your account and all its data were deleted." : undefined;
  return <AuthForm mode="login" action={loginAction} notice={notice} founding={Boolean(sp.founding)} captcha={captchaConfig()} twoFactorAction={verifyTwoFactorAction} next={next} email={sp.email?.slice(0, 200)} />;
}
