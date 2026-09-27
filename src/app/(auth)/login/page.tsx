import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "../AuthForm";
import { loginAction } from "../actions";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/app");
  return <AuthForm mode="login" action={loginAction} />;
}
