import { SUPPORT_EMAIL } from "@/lib/seo";
import { emailConfigured } from "@/lib/account";
import { ForgotForm } from "../ResetForms";
import { forgotPasswordAction } from "../actions";
import { captchaConfig } from "@/lib/captcha";

export const dynamic = "force-dynamic";

export const metadata = { title: "Forgot password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return <ForgotForm action={forgotPasswordAction} emailEnabled={emailConfigured()} support={SUPPORT_EMAIL} captcha={captchaConfig()} />;
}
