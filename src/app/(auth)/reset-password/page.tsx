import Link from "next/link";
import { resetTokenValid } from "@/lib/account";
import { AuthShell } from "../AuthForm";
import { ResetForm } from "../ResetForms";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Reset password", robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  if (!token || !resetTokenValid(token)) {
    return (
      <AuthShell title="This link has expired" subtitle="Reset links work once and are valid for 60 minutes.">
        <Link href="/forgot-password" className="btn btn-lg">Send a new link</Link>
      </AuthShell>
    );
  }
  return <ResetForm action={resetPasswordAction} token={token} />;
}
