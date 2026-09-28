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

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Parses a project's "custom words to mask" setting (one per line) into a safe literal matcher. */
export function customMatcher(terms: string | null | undefined): RegExp | null {
  const list = (terms ?? "").split(/\r?\n/).map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 100).slice(0, 300);
  if (!list.length) return null;
  // Longest first so "Anna Smith" wins over "Anna"; literal text only (no user regex, so no ReDoS).
  const alt = list.sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * Masks personal data before it is stored or sent to an AI judge: emails, card numbers, IBANs,
 * phone numbers, IP addresses, UK postcodes, UK vehicle registrations, and any custom words the
 * business adds (customer names, account codes...). Prices, dates and short numbers are left alone
 * so answers can still be checked against the knowledge base.
 */
export function redactPII(text: string, custom: RegExp | null = null): string {
  let out = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, "[iban]")
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (luhn(m.replace(/\D/g, "")) ? "[card]" : m))
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
    // UK postcodes (e.g. AL2 3TZ, sw1a 1aa, M1 1AE)
    .replace(/\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/gi, "[postcode]")
    // UK number plates, current style (AB12 CDE / ab12cde). Older formats clash with normal text ("Q3 FAQ").
    .replace(/\b[A-Z]{2}\d{2} ?[A-Z]{3}\b/gi, "[reg]")
    .replace(/(?<![\w$€£])(?:\+|00)?\d[\d\s().-]{7,}\d(?![\w%])/g, (m) => {
      // Phone numbers have 9-15 digits (E.164); longer runs are references or ids.
      const n = m.replace(/\D/g, "").length;
      return n >= 9 && n <= 15 ? "[phone]" : m;
    });
  // Names people introduce themselves with ("my name is Anna Smith", "Name: John"). Other names: use custom words.
  out = out.replace(
    /(\b(?:[Mm]y name is|[Mm]y name's|[Mm]y name’s|[Nn]ame:|[Cc]all me|[Ii] am called)\s+)[A-Z][\p{Ll}'’-]+(?:\s+[A-Z][\p{Ll}'’-]+){0,2}/gu,
    "$1[name]",
  );
  if (custom) out = out.replace(custom, "[masked]");
  return out;
}

export function redactConversations(convs: Conversation[], custom: RegExp | null = null): Conversation[] {
  return convs.map((c) => ({ ...c, turns: c.turns.map((t) => ({ ...t, content: redactPII(t.content, custom) })) }));
}

/** Masks personal data in every string inside an agent run (goal, output, tool inputs and outputs). */
export function redactDeep<T>(value: T, custom: RegExp | null = null): T {
  if (typeof value === "string") return redactPII(value, custom) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, custom)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, custom)])) as T;
  }
  return value;
}
