import { safeFetch, sha256 } from "./security";

/**
 * Imports help articles from a business's own website: the page the customer links to and, if asked,
 * the help/FAQ/policy pages it links to on the same site. Only readable text is kept (menus, scripts,
 * footers and forms are dropped). Every request goes through the SSRF-safe fetcher.
 */

export const IMPORT_MAX_PAGES = 25;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_DOC_CHARS = 60_000;
const MIN_DOC_CHARS = 120;

type Fetcher = typeof safeFetch;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", pound: "£", euro: "€", copy: "©" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Title and readable text of an HTML page. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(
    (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ");
  // Prefer the main content when the page marks it.
  const main = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if (main && main.replace(/<[^>]+>/g, "").trim().length > 200) body = main;
  body = body.replace(/<(nav|header|footer|form|aside|button|select)\b[\s\S]*?<\/\1>/gi, " ");
  const text = decodeEntities(
    body
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/?(p|div|section|h[1-6]|br|tr|table|ul|ol|dl|dt|dd|blockquote|pre)\b[^>]*>/gi, "\n")
      .replace(/<(td|th)\b[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

const SKIP_PATH = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|mp4|mp3|webm|css|js|json|xml|woff2?|ttf)$/i;
const SKIP_WORDS = /(login|log-in|signin|sign-in|signup|register|cart|checkout|basket|account|wishlist|search|logout|password|cdn-cgi|wp-admin|wp-json|feed|tag\/|author\/)/i;
const HELPFUL = /(help|faq|support|polic|shipping|deliver|return|refund|terms|warrant|pricing|price|contact|about|guide|how|kb|knowledge|article|docs)/i;

/** Same-site links worth importing, most help-like first. */
export function helpLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), base);
      if (u.origin !== base.origin || !/^https?:$/.test(u.protocol)) continue;
      u.hash = "";
      u.search = "";
      if (SKIP_PATH.test(u.pathname) || SKIP_WORDS.test(u.pathname)) continue;
      out.add(u.toString());
    } catch { /* ignore malformed links */ }
  }
  const startDir = base.pathname.replace(/[^/]*$/, "");
  const score = (u: string) => {
    const path = new URL(u).pathname;
    return (HELPFUL.test(path) ? 0 : 2) + (startDir.length > 1 && path.startsWith(startDir) ? 0 : 1);
  };
  return [...out].sort((a, b) => score(a) - score(b));
}

/** Fetches one HTML page, following up to 4 redirects (each checked by the SSRF guard). */
async function fetchPage(url: string, fetcher: Fetcher): Promise<{ url: string; html: string } | null> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetcher(current, { redirect: "manual", headers: { "user-agent": "ProofMyAI-KnowledgeImport/1.0 (+https://proofmyai.com)", accept: "text/html,application/xhtml+xml" } }, 15000);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      const next = new URL(loc, current);
      if (next.origin !== new URL(url).origin && hop > 0) return null; // stay on the customer's site
      current = next.toString();
      continue;
    }
    if (!res.ok) return null;
    if (!/html|xml/i.test(res.headers.get("content-type") ?? "text/html")) return null;
    if (Number(res.headers.get("content-length")) > MAX_PAGE_BYTES) return null;
    const html = await res.text();
    return html.length > MAX_PAGE_BYTES ? null : { url: current, html };
  }
  return null;
}

export interface ImportedDoc { title: string; content: string; url: string }

/** Imports the start page and, with crawl on, up to IMPORT_MAX_PAGES same-site help pages it links to. */
export async function importFromWebsite(startUrl: string, opts: { crawl: boolean; max?: number; fetcher?: Fetcher; deadlineMs?: number }): Promise<ImportedDoc[]> {
  const fetcher = opts.fetcher ?? safeFetch;
  const max = Math.min(opts.max ?? IMPORT_MAX_PAGES, IMPORT_MAX_PAGES);
  const deadline = Date.now() + (opts.deadlineMs ?? 45000);
  const first = await fetchPage(startUrl, fetcher);
  if (!first) throw new Error("We couldn't open that page. Check the link works in your browser and is public (not behind a login).");
  const docs: ImportedDoc[] = [];
  const seen = new Set<string>();
  const add = (url: string, html: string) => {
    const { title, text } = htmlToText(html);
    const content = text.slice(0, MAX_DOC_CHARS);
    const key = sha256(content);
    if (content.length < MIN_DOC_CHARS || seen.has(key)) return;
    seen.add(key);
    docs.push({ title: (title || new URL(url).pathname.replace(/\/$/, "").split("/").pop() || new URL(url).hostname).slice(0, 200), content, url });
  };
  add(first.url, first.html);
  if (opts.crawl) {
    const queue = helpLinks(first.html, first.url).filter((u) => u !== first.url).slice(0, max * 2);
    for (let i = 0; i < queue.length && docs.length < max && Date.now() < deadline; i += 4) {
      const batch = queue.slice(i, i + 4);
      const pages = await Promise.all(batch.map((u) => fetchPage(u, fetcher).catch(() => null)));
      for (const pg of pages) if (pg && docs.length < max) add(pg.url, pg.html);
    }
  }
  if (docs.length === 0) throw new Error("That page has no readable text we could import. Try the link to your FAQ or help center page.");
  return docs;
}
