import Link from "next/link";
import { PublicPage } from "@/components/site";
import { RELEASES } from "@/lib/changelog";

export const metadata = {
  title: "Changelog",
  description: "What's new in ProofMyAI: new features, improvements and fixes for AI chatbot, agent and n8n/Make monitoring.",
  alternates: { canonical: "/changelog" },
};

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default function ChangelogPage() {
  return (
    <PublicPage title="Changelog">
      <p>New features, improvements and fixes, newest first. Missing something? <Link href="/support?topic=feature">Request a feature</Link>.</p>
      <div className="changelog">
        {RELEASES.map((r) => (
          <article key={`${r.date}-${r.title}`} className="changelog-entry">
            <div className="faint"><time dateTime={r.date}>{fmt(r.date)}</time></div>
            <div>
              <h2><span className={`badge ${r.tag === "New" ? "badge-ok" : r.tag === "Fixed" ? "badge-warn" : ""}`}>{r.tag}</span> {r.title}</h2>
              <ul>{r.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          </article>
        ))}
      </div>
    </PublicPage>
  );
}
