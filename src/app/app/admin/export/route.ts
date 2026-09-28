import { listUsers, logAdmin, requireAdmin, SEGMENTS, type Segment } from "@/lib/admin";
import { csvCell } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = await requireAdmin();
  const sp = new URL(req.url).searchParams;
  const segment = (sp.get("segment") ?? "all") as Segment;
  const { rows } = listUsers({ q: sp.get("q") ?? "", segment: segment in SEGMENTS ? segment : "all", all: true });
  logAdmin(admin.email, "export_users", null, `${rows.length} rows`);
  const head = ["id", "email", "signed_up", "last_active", "plan", "status", "cancels_at", "suspended", "projects", "conversations_this_month"];
  const lines = rows.map((r) => [r.id, r.email, r.created_at, r.last_seen_at, r.plan, r.plan_status, r.plan_cancel_at, r.suspended_at ? "yes" : "", r.projects, r.conversations].map(csvCell).join(","));
  return new Response([head.join(","), ...lines].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="proofmyai-users-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
