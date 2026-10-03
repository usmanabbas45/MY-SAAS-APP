/**
 * Where to go after logging in or signing up. Only known in-app paths are allowed (no open redirects):
 * team invitations, and the checkout for a plan chosen on the pricing page.
 */
export function safeNext(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  if (/^\/invite\/[A-Za-z0-9_-]{10,100}$/.test(v)) return v;
  if (/^\/app\/billing\?plan=(starter|growth|agency|compliance)&period=(month|year)$/.test(v)) return v;
  return undefined;
}

/** Sign-up link that continues to the checkout of a plan. */
export const planSignupHref = (plan: string, period: "month" | "year") => `/signup?next=${encodeURIComponent(`/app/billing?plan=${plan}&period=${period}`)}`;
