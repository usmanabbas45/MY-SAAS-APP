import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { CATEGORIES, listTickets, ticketCode, ticketCounts, whatsappLink } from "@/lib/support";
import { replyTicketAction, ticketStatusAction } from "../actions";
import { AdminShell, ago } from "../ui";

export const metadata = { title: "Admin · Support" };
export const dynamic = "force-dynamic";

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ status?: string; ok?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = (["open", "answered", "closed", "all"].includes(sp.status ?? "") ? sp.status : "open") as "open" | "answered" | "closed" | "all";
  const tickets = listTickets(status);
  const counts = ticketCounts();
  return (
    <AdminShell>
      <p className="sub"><Link href="/app/admin">← Admin dashboard</Link></p>
      <h1>Support inbox</h1>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="tabs">
        {(["open", "answered", "closed", "all"] as const).map((s) => (
          <Link key={s} href={`/app/admin/support?status=${s}`} className={`tab ${s === status ? "active" : ""}`}>
            {s[0].toUpperCase() + s.slice(1)}{s !== "all" ? ` (${counts[s]})` : ""}
          </Link>
        ))}
      </div>
      {tickets.length === 0 ? <div className="card empty">No {status === "all" ? "" : status} tickets. 🎉</div> : null}
      <div className="stack">
        {tickets.map((t) => (
          <div key={t.id} id={`t${t.id}`} className="card">
            <div className="row between" style={{ flexWrap: "wrap" }}>
              <div>
                <strong className="mono">{ticketCode(t.id)}</strong> · <strong>{t.subject}</strong>
                <div className="faint">{CATEGORIES[t.category] ?? t.category} · {t.name ? `${t.name} · ` : ""}<a href={`mailto:${t.email}`}>{t.email}</a>{t.user_id ? <> · <Link href={`/app/admin/users/${t.user_id}`}>customer #{t.user_id}</Link></> : " · not logged in"} · {ago(t.created_at)}</div>
              </div>
              <span className={`badge ${t.status === "open" ? "badge-warn" : t.status === "answered" ? "badge-ok" : ""}`}>{t.status}</span>
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{t.message}</p>
            {t.page ? <p className="faint" style={{ wordBreak: "break-all" }}>Page: {t.page}</p> : null}
            {t.reply ? <div className="alert alert-ok" style={{ whiteSpace: "pre-wrap" }}><strong>Your reply ({ago(t.replied_at)}):</strong><br />{t.reply}</div> : null}
            <form action={replyTicketAction}>
              <input type="hidden" name="ticketId" value={t.id} />
              <div className="field"><label htmlFor={`r${t.id}`}>{t.reply ? "Send another reply" : "Reply"} <span className="hint">(emailed to the customer and shown in their dashboard)</span></label>
                <textarea id={`r${t.id}`} name="reply" rows={3} required /></div>
              <div className="row">
                <SubmitButton pendingText="Sending…">Send reply</SubmitButton>
                <label className="check" style={{ margin: 0 }}><input type="checkbox" name="close" value="1" /> and close the ticket</label>
              </div>
            </form>
            <div className="row" style={{ marginTop: 10 }}>
              <a className="btn btn-ghost btn-sm" href={whatsappLink(`Hi${t.name ? ` ${t.name}` : ""}, about your ProofMyAI ticket ${ticketCode(t.id)} (“${t.subject}”):`).replace(/wa\.me\/\d+/, "wa.me/")} target="_blank" rel="noopener">💬 Open WhatsApp with this ticket</a>
              {(["open", "closed"] as const).filter((s) => s !== t.status).map((s) => (
                <form key={s} action={ticketStatusAction}><input type="hidden" name="ticketId" value={t.id} /><input type="hidden" name="status" value={s} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">{s === "open" ? "Reopen" : "Close"}</SubmitButton></form>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AdminShell>
  );
}
