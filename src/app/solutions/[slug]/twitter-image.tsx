import { OG_SIZE, ogImage } from "@/lib/og";
import { SOLUTIONS } from "@/lib/seo";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "ProofMyAI";
export const generateStaticParams = () => SOLUTIONS.map((s) => ({ slug: s.slug }));

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = SOLUTIONS.find((x) => x.slug === slug);
  return ogImage({ kicker: "Quality monitoring for AI", title: s?.title ?? "ProofMyAI", footer: "Free plan · set up in minutes" });
}
