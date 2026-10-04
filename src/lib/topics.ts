/**
 * Topic of a customer question, for chatbot analytics ("what do customers ask about, and how well does the
 * bot handle each topic?"). The AI judge names the topic when AI checking is on; otherwise the matching help
 * article is used, then simple keyword rules. Topics are short labels such as "Delivery" or "Refunds".
 */
const RULES: [RegExp, string][] = [
  [/\b(human|agent|person|someone real|real person|operator|speak to|talk to)\b/i, "Talk to a human"],
  [/\b(refund|return|exchange|money back|cancel(l?ed|l?ation)?)\b/i, "Returns & refunds"],
  [/\b(deliver(y|ed)?|shipping|ship|dispatch|courier|postage|arriv(e|al)|tracking|track my)\b/i, "Delivery"],
  [/\b(price|pricing|cost|how much|fee|discount|coupon|promo|voucher|offer|deal)\b/i, "Pricing & offers"],
  [/\b(pay|payment|card|invoice|billing|charged|paypal|klarna|instal?ments?)\b/i, "Payments & billing"],
  [/\b(order|purchase|bought|basket|cart|checkout)\b/i, "Orders"],
  [/\b(account|log ?in|sign ?in|password|sign ?up|register|email address)\b/i, "Account & login"],
  [/\b(warranty|guarantee|broken|faulty|damaged|repair|defect)\b/i, "Warranty & repairs"],
  [/\b(open(ing)? hours|opening times|location|address|store|branch|near me)\b/i, "Store & opening hours"],
  [/\b(book|booking|appointment|reservation|schedule|test drive|viewing)\b/i, "Bookings"],
  [/\b(stock|available|availability|size|colou?r|spec|feature|compatible|product)\b/i, "Products"],
  [/^\s*(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you|ok|cheers)\b[\s!.?]*$/i, "Greetings & small talk"],
];

export const OTHER_TOPIC = "Other";

const clean = (t: string) => t.replace(/[^\p{L}\p{N} &'/-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);

export function ruleTopic(question: string): string | null {
  for (const [re, topic] of RULES) if (re.test(question)) return topic;
  return null;
}

/** Best topic label for a graded reply. */
export function topicFor(question: string, sourceDoc: string | null, aiTopic?: string | null): string {
  const ai = aiTopic ? clean(aiTopic) : "";
  if (ai) return ai.charAt(0).toUpperCase() + ai.slice(1);
  if (sourceDoc) return clean(sourceDoc) || OTHER_TOPIC;
  return ruleTopic(question) ?? OTHER_TOPIC;
}
