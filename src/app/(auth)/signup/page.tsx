import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "../AuthForm";
import { signupAction } from "../actions";
import { captchaConfig } from "@/lib/captcha";

export const metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ founding?: string; next?: string; email?: string }> }) {
  const { founding, next: rawNext, email } = await searchParams;
  const next = rawNext && /^\/invite\/[A-Za-z0-9_-]{10,100}$/.test(rawNext) ? rawNext : undefined;
  if (await currentUser()) redirect(next ?? (founding ? "/app/founding" : "/app"));
  return <AuthForm mode="signup" action={signupAction} founding={Boolean(founding)} captcha={captchaConfig()} next={next} email={email?.slice(0, 200)} />;
}
