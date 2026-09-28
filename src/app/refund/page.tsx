import Link from "next/link";
import { PublicPage } from "@/components/site";
import { SUPPORT_EMAIL } from "@/lib/seo";

export const metadata = { title: "Refund Policy", description: "ProofMyAI's 14-day free trial and 14-day money-back guarantee.", alternates: { canonical: "/refund" } };

export default function RefundPage() {
  return (
    <PublicPage title="Refund Policy" updated="28 September 2026">
      <p>We want you to be sure ProofMyAI is right for you before you pay, and happy after you do.</p>
      <h2>Free audit and free trial</h2>
      <p>You can run a free one-time AI audit without a card. Paid plans start with a <strong>14-day free trial</strong>. If you cancel before the trial ends, you are not charged.</p>
      <h2>14-day money-back guarantee</h2>
      <p>If you are not happy, ask for a refund within <strong>14 days</strong> of any payment and you will receive a full refund of that payment. No questions asked.</p>
      <h2>After 14 days</h2>
      <p>Payments older than 14 days are not refunded, but you can cancel at any time and keep access until the end of the period you paid for. You will not be charged again.</p>
      <h2>How to ask for a refund</h2>
      <p>Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the email address of your account, or reply to your Paddle receipt. Refunds are processed by our reseller Paddle.com to your original payment method, usually within 5–10 business days.</p>
      <p>See also our <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
    </PublicPage>
  );
}
