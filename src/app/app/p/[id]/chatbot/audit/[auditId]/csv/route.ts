import { currentUser } from "@/lib/auth";
import { csvCell } from "@/lib/csv";
import { all, get } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; auditId: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Not logged in", { status: 401 });
  const { id, auditId } = await params;
  const audit = get<{ id: number; name: string }>(
    "SELECT a.id, a.name FROM audits a JOIN projects p ON p.id = a.project_id WHERE a.id = ? AND p.id = ? AND p.user_id = ?",
    Number(auditId), Number(id), user.id,
  );
  if (!audit) return new Response("Not found", { status: 404 });
  const rows = all<Record<string, unknown>>(
    `SELECT conversation_id, turn_index, question, answer, verdict, corrected_verdict, severity, reason, source_doc,
            ROUND(risk * 100) AS risk_percent, frustrated, rule_hit, feedback, created_at
       FROM audit_items WHERE audit_id = ? ORDER BY id`, audit.id,
  );
  const header = ["conversation_id", "turn_index", "question", "answer", "verdict", "corrected_verdict", "severity", "reason", "source_doc", "risk_percent", "frustrated", "rule_hit", "feedback", "created_at"];
  const csv = [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(","))].join("\r\n");
  const file = audit.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "audit";
  return new Response(`﻿${csv}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}.csv"` },
  });
}
