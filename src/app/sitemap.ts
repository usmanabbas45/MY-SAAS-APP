import type { MetadataRoute } from "next";
import { SITE_URL, SOLUTIONS } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (path: string, priority: number, changeFrequency: "weekly" | "monthly" | "yearly") =>
    ({ url: `${SITE_URL}${path}`, lastModified: now, changeFrequency, priority });
  return [
    page("/", 1, "weekly"),
    ...SOLUTIONS.map((s) => page(`/solutions/${s.slug}`, 0.9, "monthly")),
    page("/signup", 0.7, "monthly"),
    page("/security", 0.6, "monthly"),
    page("/about", 0.5, "yearly"),
    page("/dpa", 0.4, "yearly"),
    page("/contact", 0.5, "yearly"),
    page("/login", 0.4, "yearly"),
    page("/privacy", 0.3, "yearly"),
    page("/terms", 0.3, "yearly"),
    page("/refund", 0.3, "yearly"),
  ];
}
