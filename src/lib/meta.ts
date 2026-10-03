/** Meta descriptions over ~160 characters get cut off by Google: shorten at a word boundary. */
export function metaDescription(s: string, max = 158): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.\s]+$/, "")}…`;
}

/** Keeps "· ProofMyAI" only when the whole title still fits in Google's ~60 characters. */
export const metaTitle = (t: string) => (t.length + 12 > 60 ? { absolute: t } : t);
