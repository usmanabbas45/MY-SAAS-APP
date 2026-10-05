import type { MetadataRoute } from "next";
import { POSTS } from "@/lib/blog";
import { SITE_URL, SOLUTIONS } from "@/lib/seo";
import { COMPARISONS } from "@/lib/compare";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (path: string, priority: number, changeFrequency: "weekly" | "monthly" | "yearly") =>
    ({ url: `${SITE_URL}${path}`, lastModified: now, changeFrequency, priority });
  return [
    page("/", 1, "weekly"),
    ...SOLUTIONS.map((s) => page(`/solutions/${s.slug}`, 0.9, "monthly")),
    page("/tools/ai-chatbot-checker", 0.9, "monthly"),
    page("/free-audit", 0.8, "monthly"),
    ...COMPARISONS.map((c) => page(`/compare/${c.slug}`, 0.7, "monthly")),
    page("/blog", 0.8, "weekly"),
    ...POSTS.map((p) => ({ url: `${SITE_URL}/blog/${p.slug}`, lastModified: new Date(`${p.updated ?? p.date}T12:00:00Z`), changeFrequency: "monthly" as const, priority: 0.8 })),
    page("/signup", 0.7, "monthly"),
    page("/security", 0.6, "monthly"),
    page("/about", 0.5, "yearly"),
    page("/support", 0.5, "monthly"),
    page("/docs", 0.7, "monthly"),
    page("/changelog", 0.5, "weekly"),
    page("/status", 0.3, "weekly"),
    page("/dpa", 0.4, "yearly"),
    page("/contact", 0.5, "yearly"),
    page("/privacy", 0.3, "yearly"),
    page("/terms", 0.3, "yearly"),
    page("/refund", 0.3, "yearly"),
  ];
}
