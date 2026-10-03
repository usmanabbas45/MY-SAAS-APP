import { SITE_URL, SUPPORT_EMAIL } from "@/lib/seo";

/** RFC 9116: tells security researchers how to report a vulnerability. */
export function GET() {
  const expires = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const body = [
    `Contact: mailto:${SUPPORT_EMAIL}`,
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    `Canonical: ${SITE_URL}/.well-known/security.txt`,
    `Policy: ${SITE_URL}/security`,
  ].join("\n") + "\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
}
