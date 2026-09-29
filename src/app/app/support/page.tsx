import Link from "next/link";
import { ThemeToggle } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { CATEGORIES, DEVELOPER_NAME, DEVELOPER_URL, ticketCode, userTickets, WHATSAPP_DISPLAY, whatsappLink } from "@/lib/support";
import { logoutAction } from "../../(auth)/actions";
import { submitTicketAction } from "../../support/actions";
import { TicketForm } from "../../support/TicketForm";

export const metadata = { title: "Help & support" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Waiting for our reply", tone: "badge-warn" },
  answered: { label: "Answered", tone: "badge-ok" },
  closed: { label: "Closed", tone: "" },
};

export default async function AppSupportPage() {
  const user = await requireUser();
  const tickets = userTickets(user.id);
  const projects = listProjects(user.id);
  return (
    <div>
      <nav className="lp-nav">
        <Link href="/app?new=1" className="logo"><span className="logo-mark" aria-hidden>✓</span>ProofMyAI</Link>
        <div className="row">
          <ThemeToggle />
          <form action={logoutAction}><button className="btn btn-ghost btn-sm">Log out</button></form>
        </div>
      </nav>
      <main className="content" style={{ margin: "0 auto", maxWidth: 900 }}>
        <p className="sub"><Link href={projects[0] ? `/app/p/${projects[0].id}` : "/app"}>← Back to dashboard</Link></p>
        <h1>Help &amp; support</h1>
        <div className="grid grid-3 support-options">
          <a className="card support-card" href={whatsappLink(`Hi! I'm ${user.email} on ProofMyAI and need help.`)} target="_blank" rel="noopener">
            <span className="support-icon">💬</span><strong>WhatsApp</strong><span className="sub">{WHATSAPP_DISPLAY}</span>
          </a>
          <a className="card support-card" href="#ticket"><span className="support-icon">🎫</span><strong>Submit a ticket</strong><span className="sub">Errors, bugs, billing, setup</span></a>
          <a className="card support-card" href={DEVELOPER_URL} target="_blank" rel="noopener"><span className="support-icon">👨‍💻</span><strong>Hire the developer</strong><span className="sub">{DEVELOPER_NAME}</span></a>
        </div>

        {tickets.length ? (
          <div className="card">
            <h2>Your tickets</h2>
            <div className="stack">
              {tickets.map((t) => (
                <details key={t.id} open={t.status === "answered"}>
                  <summary>
                    <span className="mono">{ticketCode(t.id)}</span> · {t.subject} <span className={`badge ${STATUS[t.status]?.tone ?? ""}`} style={{ marginLeft: 6 }}>{STATUS[t.status]?.label ?? t.status}</span>
                  </summary>
                  <p className="faint" style={{ margin: "0 0 6px" }}>{CATEGORIES[t.category] ?? t.category} · sent {t.created_at.slice(0, 10)}</p>
                  <p style={{ whiteSpace: "pre-wrap" }}>{t.message}</p>
                  {t.reply ? (
                    <div className="alert alert-ok" style={{ whiteSpace: "pre-wrap" }}><strong>Our reply ({t.replied_at?.slice(0, 10)}):</strong><br />{t.reply}</div>
                  ) : <p className="sub">We&apos;ll reply by email and here. Urgent? <a href={whatsappLink(`About ticket ${ticketCode(t.id)}: ${t.subject}`)} target="_blank" rel="noopener">Send it on WhatsApp</a>.</p>}
                </details>
              ))}
            </div>
          </div>
        ) : null}

        <h2 style={{ marginTop: 24 }}>Report an issue</h2>
        <p className="sub">We&apos;ll reply to <strong>{user.email}</strong>. Tip: include the page link and the exact error message.</p>
        <TicketForm action={submitTicketAction} categories={CATEGORIES} email={user.email} />
      </main>
    </div>
  );
}
