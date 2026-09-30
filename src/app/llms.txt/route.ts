import { llmsTxt } from "@/lib/llms";

export const dynamic = "force-static";

export function GET() {
  return new Response(llmsTxt(), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
