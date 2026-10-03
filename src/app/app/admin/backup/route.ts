import fs from "node:fs";
import { logAdmin, requireAdmin } from "@/lib/admin";
import { backupPath, snapshot } from "@/lib/backup";

export const dynamic = "force-dynamic";

/** Admin download: ?file=<saved backup>, or a fresh copy right now. Restore with scripts/restore-backup.mjs. */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  const file = new URL(req.url).searchParams.get("file");
  let body: Buffer;
  let name: string;
  if (file) {
    const p = backupPath(file);
    if (!p) return new Response("Backup not found", { status: 404 });
    body = fs.readFileSync(p);
    name = file;
  } else {
    body = snapshot();
    name = `proofmyai-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.db.gz`;
  }
  logAdmin(admin.email, "download_backup", null, name);
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
