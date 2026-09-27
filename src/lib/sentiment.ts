const NEGATIVE = /\b(angry|furious|annoyed|frustrat\w*|ridiculous|useless|terrible|awful|worst|hate|unacceptable|disappointed|joke|scam|waste|stupid|broken|never again|fed up|what the|wtf|seriously|still waiting|no one|nobody|not helpful|doesn'?t help|you('re| are) not listening|real person|human please|cancel my)\b/i;

/**
 * Flags customers who sound frustrated (a churn and escalation risk). Rule-based so it works
 * offline and in every mode; the signals are strong negative words, shouting and repeated "!!"/"??".
 */
export function isFrustrated(customerText: string): boolean {
  const text = customerText.trim();
  if (!text) return false;
  if (NEGATIVE.test(text)) return true;
  if (/[!?]{3,}/.test(text)) return true;
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 12 && letters === letters.toUpperCase();
}
