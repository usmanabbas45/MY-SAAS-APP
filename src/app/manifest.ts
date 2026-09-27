import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ProofMyAI · AI quality monitoring",
    short_name: "ProofMyAI",
    description: "Monitor AI chatbots, AI agents and n8n/Make workflows.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#5b4bf5",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
