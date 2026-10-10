import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { helpLinks, htmlToText, importFromWebsite } from "@/lib/kbimport";
import { parseTranscripts } from "@/lib/audit/parse";

const page = (title: string, body: string, links = "") => `<!doctype html><html><head><title>${title} | Shop</title><script>var x = "secret";</script><style>.a{}</style></head>
<body><header><nav><a href="/login">Login</a><a href="/cart">Cart</a></nav></header>
<main><h1>${title}</h1>${body}${links}</main><footer>© Shop &amp; Co</footer></body></html>`;

const SITE: Record<string, string> = {
  "https://shop.example/help": page("Help centre", "<p>Welcome to our help centre. Find answers about orders, delivery, returns and payments below. We reply within one working day.</p>",
    '<a href="/help/shipping">Shipping</a> <a href="/help/returns#top">Returns</a> <a href="https://other.example/x">Partner</a> <a href="/img/logo.png">Logo</a> <a href="/login">Log in</a>'),
  "https://shop.example/help/shipping": page("Shipping &amp; delivery", "<p>UK delivery costs £3.95 and takes 2–3 working days.</p><ul><li>Free over £40</li><li>We ship to the UK and Ireland only</li></ul>"),
  "https://shop.example/help/returns": page("Returns", "<p>Full-price items can be returned within 30 days for a refund. Sale items can be returned for store credit only, not a refund.</p>"),
};

const fetcher = (async (url: string) => {
  if (url === "http://shop.example/help") return new Response(null, { status: 301, headers: { location: "https://shop.example/help" } });
  const html = SITE[url];
  return html ? new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("nope", { status: 404 });
}) as never;

describe("knowledge base import from a website", () => {
  it("keeps the readable content and drops menus, scripts and footers", () => {
    const { title, text } = htmlToText(SITE["https://shop.example/help/shipping"]);
    expect(title).toBe("Shipping & delivery");
    expect(text).toContain("UK delivery costs £3.95");
    expect(text).toContain("• Free over £40");
    expect(text).not.toMatch(/secret|Login|Cart|© Shop/);
  });

  it("follows same-site help links only", () => {
    expect(helpLinks(SITE["https://shop.example/help"], "https://shop.example/help")).toEqual(["https://shop.example/help/shipping", "https://shop.example/help/returns"]);
  });

  it("imports the page and the pages it links to, following redirects", async () => {
    const docs = await importFromWebsite("http://shop.example/help", { crawl: true, fetcher });
    expect(docs.map((d) => d.title)).toEqual(["Help centre", "Shipping & delivery", "Returns"]);
    expect(docs[2].content).toContain("store credit only");
    expect((await importFromWebsite("https://shop.example/help", { crawl: false, fetcher })).length).toBe(1);
    await expect(importFromWebsite("https://shop.example/missing", { crawl: true, fetcher })).rejects.toThrow(/couldn't open/);
  });
});

describe("sample transcript file", () => {
  it("is a valid upload with 4 conversations", () => {
    const convs = parseTranscripts(fs.readFileSync("public/samples/proofmyai-sample-chats.csv", "utf8"));
    expect(convs).toHaveLength(4);
    expect(convs[1].turns[1]).toEqual({ role: "assistant", content: "Of course! Full refund on everything, no questions asked 😊" });
  });
});
