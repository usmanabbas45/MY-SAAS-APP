import { indexNowKey } from "@/lib/indexnow";

export const dynamic = "force-dynamic";

/** IndexNow key file: search engines fetch it to confirm our submissions are genuine. */
export function GET() {
  return new Response(indexNowKey(), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
