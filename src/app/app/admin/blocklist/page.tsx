import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { listBlocks } from "@/lib/blocklist";
import { addBlockAction, removeBlockAction } from "../actions";
import { AdminShell, ago } from "../ui";

export const metadata = { title: "Admin · Blocklist" };
export const dynamic = "force-dynamic";

export default async function BlocklistPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const blocks = listBlocks();
  return (
    <AdminShell>
      <p className="sub"><Link href="/app/admin">← Admin dashboard</Link></p>
      <h1>🚫 Blocklist</h1>
      <p className="sub">Blocked emails and domains can&apos;t create an account. Blocking also suspends matching existing accounts: they are logged out, can&apos;t log in, and their API keys stop working. Admin accounts can never be blocked.</p>
      <Flash ok={sp.ok} error={sp.error} />
      <form action={addBlockAction} className="card">
        <h2 style={{ marginTop: 0 }}>Add a block</h2>
        <div className="grid grid-2">
          <div className="field"><label htmlFor="b-pattern">Email or domain</label><input id="b-pattern" name="pattern" required placeholder="spammer@example.com  or  @example.com" /></div>
          <div className="field"><label htmlFor="b-reason">Reason <span className="hint">(only you see this)</span></label><input id="b-reason" name="reason" maxLength={300} placeholder="e.g. abuse, fake sign-ups, chargeback" /></div>
        </div>
        <p className="faint">A domain like <code>@example.com</code> also blocks its subdomains (<code>@mail.example.com</code>).</p>
        <SubmitButton className="btn btn-danger" pendingText="Blocking…" confirm="Block this email/domain and suspend matching accounts?">🚫 Block</SubmitButton>
      </form>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Blocked ({blocks.length})</h2>
        {blocks.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Email / domain</th><th>Reason</th><th>Added</th><th /></tr></thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.pattern}</td>
                  <td>{b.reason ?? <span className="faint">–</span>}</td>
                  <td>{ago(b.created_at)}<span className="faint"> by {b.created_by}</span></td>
                  <td style={{ textAlign: "right" }}>
                    <form action={removeBlockAction}><input type="hidden" name="id" value={b.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Unblock</SubmitButton></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="sub">Nobody is blocked.</p>}
      </div>
    </AdminShell>
  );
}
