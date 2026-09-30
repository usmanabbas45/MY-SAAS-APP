import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "../AuthForm";
import { loginAction } from "../actions";

export const metadata = { title: "Log in", robots: { index: false, follow: true } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string; deleted?: string; founding?: string }> }) {
  const sp = await searchParams;
  if (await currentUser()) redirect(sp.founding ? "/app/founding" : "/app");
  const notice = sp.reset ? "Your password was changed. Log in with your new password." : sp.deleted ? "Your account and all its data were deleted." : undefined;
  return <AuthForm mode="login" action={loginAction} notice={notice} founding={Boolean(sp.founding)} />;
}
