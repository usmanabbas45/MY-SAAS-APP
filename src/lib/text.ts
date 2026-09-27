const STOPWORDS = new Set(
  (
    "a an and are as at be but by can could do does for from had has have how i if in into is it its " +
    "just me my no not of on or our so than that the their them then there these they this to too " +
    "us was we were what when where which who will with would you your yes please thanks thank hi hello " +
    "am been being did doing about also any all more most other some such only own same very s t"
  ).split(" "),
);

/** Light English stemming so "refunds"/"refund" and "policies"/"policy" match. */
export function stem(word: string): string {
  if (/\d/.test(word) || word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'.-]*/gu) ?? [])
    .map((t) => t.replace(/[.'-]+$/, "").replace(/'s$/, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export function contentSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

/** Fraction of `a`'s content words that also appear in `b` (0..1). */
export function coverage(a: string, b: string | Set<string>): number {
  const words = tokenize(a);
  if (words.length === 0) return 1;
  const set = typeof b === "string" ? contentSet(b) : b;
  return words.filter((w) => set.has(w)).length / words.length;
}

/** Numbers, prices, percentages and durations mentioned in text, normalised. */
export function extractNumbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
