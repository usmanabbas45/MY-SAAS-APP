import { judgeProvider } from "./judge/llm";

/** Who operates ProofMyAI. Set LEGAL_NAME / LEGAL_COUNTRY on the server to the exact legal details. */
export const LEGAL_NAME = process.env.LEGAL_NAME?.trim() || "Muhammad Usman";
export const LEGAL_COUNTRY = process.env.LEGAL_COUNTRY?.trim() || "Pakistan";
export const OPERATOR = `${LEGAL_NAME}, sole proprietor, ${LEGAL_COUNTRY}`;
/** Where the application and database run, e.g. "EU West (Amsterdam)". Set HOSTING_REGION to match the Railway region. */
export const HOSTING_REGION = process.env.HOSTING_REGION?.trim() || "";

export interface Subprocessor { name: string; purpose: string; data: string; location: string; active: boolean }

/** The AI provider actually in use, for legal copy ("Anthropic (Claude)"), or null when none is configured. */
export function aiProviderName(): string | null {
  const judge = judgeProvider();
  return judge === "anthropic" ? "Anthropic (Claude)" : judge === "gemini" ? "Google (Gemini)" : null;
}

/** Service providers that process customer data. AI providers are listed only when they are actually in use. */
export function subprocessors(): Subprocessor[] {
  const judge = judgeProvider();
  const geminiPaid = process.env.GEMINI_PAID_TIER === "1";
  return [
    { name: "Railway Corporation", purpose: "Application hosting and database", data: "All service data", location: HOSTING_REGION || "Cloud region on request", active: true },
    {
      name: "Anthropic PBC (Claude API)", purpose: "AI judge, only for projects with AI checking on", data: "Masked chat text, agent runs, help articles",
      location: "United States", active: judge === "anthropic",
    },
    {
      name: `Google LLC (Gemini API${geminiPaid ? ", paid tier" : ""})`, purpose: "AI judge, only for projects with AI checking on", data: "Masked chat text, agent runs, help articles",
      location: "United States / global", active: judge === "gemini",
    },
  ].filter((s) => s.active || !s.purpose.startsWith("AI judge")).concat([
    { name: "Resend, Inc.", purpose: "Emails (alerts, summaries, password resets)", data: "Account email, alert summaries", location: "United States", active: Boolean(process.env.RESEND_API_KEY) },
    { name: "Paddle.com Market Ltd", purpose: "Payments and invoicing (Merchant of Record)", data: "Billing name, email, payment details", location: "United Kingdom", active: Boolean(process.env.PADDLE_API_KEY) },
  ]);
}

/** Plain-language statement about whether the active AI provider may use submitted content. */
export function aiTrainingStatement(): string {
  const judge = judgeProvider();
  if (judge === "anthropic") return "Anthropic does not train its models on data sent through its commercial API.";
  if (judge === "gemini") {
    return process.env.GEMINI_PAID_TIER === "1"
      ? "We use Google's paid Gemini API tier, under which Google does not use prompts or responses to improve its products."
      : "The AI judge currently uses Google's free Gemini API tier, whose terms allow Google to use submitted content to improve its products. For customer data, switch AI checking off for the project (Settings → Data & privacy) until the paid tier is enabled.";
  }
  return "No AI provider is configured: all checks run inside ProofMyAI.";
}
