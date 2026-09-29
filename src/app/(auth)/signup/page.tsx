import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "../AuthForm";
import { signupAction } from "../actions";

export const metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ founding?: string }> }) {
  const { founding } = await searchParams;
  if (await currentUser()) redirect(founding ? "/app/founding" : "/app");
  return <AuthForm mode="signup" action={signupAction} founding={Boolean(founding)} />;
}
