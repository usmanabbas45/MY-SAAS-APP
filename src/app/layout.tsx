import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AgentProof - Proof your AI works", template: "%s · AgentProof" },
  description: "Quality monitoring for AI chatbots, AI agents and n8n/Make workflows. Catch wrong answers, broken agents and silent automation failures before customers do.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Applies the saved theme before paint to avoid a light/dark flash.
const themeScript = `try{var t=localStorage.getItem("ap-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
