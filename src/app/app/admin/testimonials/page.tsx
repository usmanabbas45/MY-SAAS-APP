import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { listTestimonials, testimonialCounts, type Testimonial } from "@/lib/testimonials";
import { addTestimonialAction, testimonialStatusAction } from "../actions";
import { AdminShell, ago } from "../ui";

export const metadata = { title: "Admin · Testimonials" };
export const dynamic = "force-dynamic";

const TABS = ["pending", "approved", "hidden"] as const;

function StatusButton({ id, status, label, confirm }: { id: number; status: string; label: string; confirm?: string }) {
  return (
    <form action={testimonialStatusAction}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} />
      <SubmitButton className={status === "approved" ? "btn btn-sm" : "btn btn-ghost btn-sm"} pendingText="…" confirm={confirm}>{label}</SubmitButton>
    </form>
  );
}

export default async function AdminTestimonialsPage({ searchParams }: { searchParams: Promise<{ status?: string; ok?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status: Testimonial["status"] = TABS.includes(sp.status as Testimonial["status"]) ? (sp.status as Testimonial["status"]) : "pending";
  const list = listTestimonials(status);
  const counts = testimonialCounts();
  return (
    <AdminShell>
      <p className="sub"><Link href="/app/admin">← Admin dashboard</Link></p>
      <h1>Testimonials &amp; feedback</h1>
      <p className="sub">Customers send feedback from <strong>Share feedback</strong> in their dashboard. Only feedback where they ticked &quot;may show on the website&quot; can be published. Published quotes replace the founding-customer offer on the homepage.</p>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="tabs">
        {TABS.map((s) => <Link key={s} href={`/app/admin/testimonials?status=${s}`} className={`tab ${s === status ? "active" : ""}`}>{s === "approved" ? "Published" : s[0].toUpperCase() + s.slice(1)} ({counts[s]})</Link>)}
      </div>
      {list.length === 0 ? <div className="card empty">Nothing here yet.</div> : null}
      <div className="stack">
        {list.map((t) => (
          <div key={t.id} className="card">
            <div className="row between" style={{ flexWrap: "wrap" }}>
              <div><span style={{ color: "var(--warn)" }}>{"★".repeat(t.rating)}{"☆".repeat(5 - t.rating)}</span> <strong>{t.name}</strong>{t.role || t.company ? <span className="faint"> · {[t.role, t.company].filter(Boolean).join(", ")}</span> : null}</div>
              <span className="faint">{t.source === "manual" ? "added by admin" : t.user_id ? <Link href={`/app/admin/users/${t.user_id}`}>customer #{t.user_id}</Link> : "former customer"} · {ago(t.created_at)}</span>
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: "10px 0" }}>&ldquo;{t.quote}&rdquo;</p>
            {t.result ? <p className="sub">Result: {t.result}</p> : null}
            {t.website ? <p className="faint" style={{ wordBreak: "break-all" }}>{t.website}</p> : null}
            <p>{t.consent ? <span className="badge badge-ok">May be published</span> : <span className="badge badge-warn">Private feedback: no permission to publish</span>}</p>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {t.status !== "approved" && t.consent ? <StatusButton id={t.id} status="approved" label="Publish on homepage" /> : null}
              {t.status === "approved" ? <StatusButton id={t.id} status="hidden" label="Unpublish" /> : null}
              {t.status === "pending" ? <StatusButton id={t.id} status="hidden" label="Archive" /> : null}
              <StatusButton id={t.id} status="delete" label="Delete" confirm="Delete this feedback permanently?" />
            </div>
          </div>
        ))}
      </div>

      <details className="card" style={{ marginTop: 24 }}>
        <summary><strong>+ Add a quote you received by WhatsApp or email</strong></summary>
        <form action={addTestimonialAction} style={{ marginTop: 14 }}>
          <div className="field"><label htmlFor="a-quote">Quote (their exact words)</label><textarea id="a-quote" name="quote" rows={3} required minLength={20} maxLength={600} /></div>
          <div className="field"><label htmlFor="a-result">Concrete result <span className="hint">(optional)</span></label><input id="a-result" name="result" maxLength={160} /></div>
          <div className="grid grid-2">
            <div className="field"><label htmlFor="a-name">Name</label><input id="a-name" name="name" required maxLength={80} /></div>
            <div className="field"><label htmlFor="a-role">Role</label><input id="a-role" name="role" maxLength={80} /></div>
            <div className="field"><label htmlFor="a-company">Company</label><input id="a-company" name="company" maxLength={80} /></div>
            <div className="field"><label htmlFor="a-web">Website</label><input id="a-web" name="website" type="url" maxLength={200} placeholder="https://" /></div>
          </div>
          <div className="field"><label htmlFor="a-rating">Rating</label><select id="a-rating" name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}</select></div>
          <label className="check"><input type="checkbox" name="consent" value="1" required /> The customer agreed in writing that we may publish this with their name.</label>
          <div style={{ marginTop: 12 }}><SubmitButton pendingText="Saving…">Add and publish</SubmitButton></div>
        </form>
      </details>
    </AdminShell>
  );
}
