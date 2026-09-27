import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "../AuthForm";
import { signupAction } from "../actions";

export const metadata = { title: "Sign up" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/app");
  return <AuthForm mode="signup" action={signupAction} />;
}
