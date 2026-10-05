/**
 * Marketing attribution: which channel brought each sign-up and lead (LinkedIn, Reddit, Google, Product Hunt…).
 * The first visit is remembered in a small first-party cookie, only for visitors who accepted analytics
 * cookies (set by the cookie banner, or by the middleware on later visits). UTM links on the free-audit page
 * are read straight from the URL, so outreach is credited even without the cookie.
 */

export const ATTR_COOKIE = "pm_src";
export const ATTR_MAX_AGE = 90 * 86400;

export interface Attribution { source: string | null; medium: string | null; campaign: string | null; referrer: string | null; landing: string | null }

const clean = (v: string | null | undefined, max = 80) => {
  const s = (v ?? "").trim().toLowerCase().replace(/[^a-z0-9._\-/ ]/g, "").slice(0, max);
  return s || null;
};

export function encodeAttribution(a: Attribution): string {
  const p = new URLSearchParams();
  if (a.source) p.set("s", a.source);
  if (a.medium) p.set("m", a.medium);
  if (a.campaign) p.set("c", a.campaign);
  if (a.referrer) p.set("r", a.referrer);
  if (a.landing) p.set("l", a.landing);
  return p.toString();
}

export function parseAttribution(raw: string | null | undefined): Attribution | null {
  if (!raw) return null;
  try {
    // Accept both the plain form ("s=x&l=/") and the URL-encoded form a browser-set cookie may arrive in.
    const text = !raw.includes("=") && /%3D/i.test(raw) ? decodeURIComponent(raw) : raw;
    const p = new URLSearchParams(text);
    const a = { source: clean(p.get("s")), medium: clean(p.get("m")), campaign: clean(p.get("c")), referrer: clean(p.get("r")), landing: clean(p.get("l"), 200) };
    return a.source || a.referrer || a.landing ? a : null;
  } catch {
    return null;
  }
}

/** Builds an attribution from a landing URL and the referring page (null when there is nothing to remember). */
export function attributionFrom(url: URL, referrer: string | null | undefined, ownHost: string): Attribution | null {
  let refHost: string | null = null;
  try {
    if (referrer) refHost = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
  } catch { /* ignore malformed referrers */ }
  if (refHost && (refHost === ownHost.replace(/^www\./, "").toLowerCase() || refHost.endsWith(".up.railway.app"))) refHost = null;
  const source = clean(url.searchParams.get("utm_source")) ?? clean(url.searchParams.get("ref_source"));
  if (!source && !refHost) return null;
  return {
    source,
    medium: clean(url.searchParams.get("utm_medium")),
    campaign: clean(url.searchParams.get("utm_campaign")),
    referrer: clean(refHost),
    landing: clean(url.pathname, 200),
  };
}

const HOST_CHANNELS: [RegExp, string][] = [
  [/(^|\.)google\./, "Google"], [/(^|\.)bing\.com$/, "Bing"], [/duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, "ChatGPT"], [/perplexity\.ai$/, "Perplexity"], [/(claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/, "AI assistants"],
  [/(^|\.)linkedin\.com$|lnkd\.in$/, "LinkedIn"], [/(^|\.)reddit\.com$/, "Reddit"], [/(^|\.)(facebook\.com|fb\.com|instagram\.com|l\.facebook\.com)$/, "Facebook / Instagram"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, "X / Twitter"], [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"], [/producthunt\.com$/, "Product Hunt"],
  [/(^|\.)upwork\.com$/, "Upwork"], [/(^|\.)fiverr\.com$/, "Fiverr"], [/(^|\.)github\.com$/, "GitHub"], [/indiehackers\.com$/, "Indie Hackers"],
  [/community\.n8n\.io$|(^|\.)n8n\.io$/, "n8n community"], [/(^|\.)(whatsapp\.com|wa\.me)$/, "WhatsApp"],
  [/(mail\.google\.com|outlook\.|mail\.)/, "Email"],
];

const SOURCE_CHANNELS: Record<string, string> = {
  google: "Google", bing: "Bing", linkedin: "LinkedIn", reddit: "Reddit", facebook: "Facebook / Instagram", fb: "Facebook / Instagram",
  instagram: "Facebook / Instagram", meta: "Facebook / Instagram", twitter: "X / Twitter", x: "X / Twitter", youtube: "YouTube",
  producthunt: "Product Hunt", product_hunt: "Product Hunt", upwork: "Upwork", fiverr: "Fiverr", email: "Email", newsletter: "Email",
  outreach: "Outreach", whatsapp: "WhatsApp", n8n: "n8n community", indiehackers: "Indie Hackers", chatgpt: "ChatGPT", perplexity: "Perplexity",
};

/** Human-friendly channel name used in the admin reports. */
export function channelOf(a: Attribution | null): string {
  if (!a) return "Direct / unknown";
  if (a.source) {
    const key = a.source.replace(/\.com$/, "").replace(/[\s-]/g, "_");
    const base = SOURCE_CHANNELS[key] ?? SOURCE_CHANNELS[key.split(/[._]/)[0]] ?? a.source;
    const paid = a.medium && /^(cpc|ppc|paid|ads?|paid_social|display|video)$/.test(a.medium);
    return paid ? `${base} (ads)` : base;
  }
  if (a.referrer) {
    const hit = HOST_CHANNELS.find(([re]) => re.test(a.referrer!));
    return hit ? hit[1] : a.referrer;
  }
  return "Direct / unknown";
}
