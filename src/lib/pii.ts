import type { Conversation } from "./judge/types";

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Masks personal data before it is stored or sent to an AI judge: emails, card numbers,
 * IBANs, phone numbers and IP addresses. Prices, dates and short numbers are left alone
 * so answers can still be checked against the knowledge base.
 */
export function redactPII(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, "[iban]")
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (luhn(m.replace(/\D/g, "")) ? "[card]" : m))
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
    .replace(/(?<![\w$€£])(?:\+|00)?\d[\d\s().-]{7,}\d(?![\w%])/g, (m) => {
      // Phone numbers have 9-15 digits (E.164); longer runs are references or ids.
      const n = m.replace(/\D/g, "").length;
      return n >= 9 && n <= 15 ? "[phone]" : m;
    });
}

export function redactConversations(convs: Conversation[]): Conversation[] {
  return convs.map((c) => ({ ...c, turns: c.turns.map((t) => ({ ...t, content: redactPII(t.content) })) }));
}
