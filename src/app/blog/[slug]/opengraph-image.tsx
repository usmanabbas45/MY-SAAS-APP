import { POSTS, postBySlug } from "@/lib/blog";
import { OG_SIZE, ogImage } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "ProofMyAI guide";
export const generateStaticParams = () => POSTS.map((p) => ({ slug: p.slug }));

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const p = postBySlug((await params).slug);
  return ogImage({ kicker: p ? `Guide · ${p.readMins} min read` : "Guide", title: p?.title ?? "ProofMyAI guides", footer: p?.tags.slice(0, 3).join(" · ") ?? "" });
}
