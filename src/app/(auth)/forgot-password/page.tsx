import { emailConfigured } from "@/lib/account";
import { ForgotForm } from "../ResetForms";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Forgot password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return <ForgotForm action={forgotPasswordAction} emailEnabled={emailConfigured()} support={process.env.SUPPORT_EMAIL || "support@proofmyai.com"} />;
}
