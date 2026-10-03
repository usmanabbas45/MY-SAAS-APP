import { SubmitButton } from "@/components/client";
import { isVerified } from "@/lib/verify";
import { resendVerificationAction } from "../app/(auth)/actions";

/** "Confirm your email" banner for accounts that haven't clicked the link yet. */
export function VerifyBanner({ userId, email }: { userId: number; email: string }) {
  if (isVerified(userId)) return null;
  return (
    <div className="alert alert-warn verify-banner" role="status">
      <span>✉️ <strong>Confirm your email.</strong> We sent a link to <strong>{email}</strong>. Until you click it, alerts to other addresses and team invitations are paused.</span>
      <form action={resendVerificationAction}><SubmitButton className="btn btn-sm" pendingText="Sending…">Resend link</SubmitButton></form>
    </div>
  );
}
