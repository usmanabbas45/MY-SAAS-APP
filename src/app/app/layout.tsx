import type { Metadata } from "next";

// The dashboard is private: keep it out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
