import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { adminEmails } from "./admin";
import { get, getDb, run } from "./db";
import { systemEmail } from "./emails";
import { emailAdmins, reportError } from "./monitoring";
import { SITE_URL } from "./seo";

/**
 * Daily database backups. Once a day a consistent copy of the SQLite database is made (VACUUM INTO, safe
 * while the app is running), compressed, and:
 *  1. kept on the server for KEEP_DAYS days (protects against mistakes and corruption), and
 *  2. emailed to ADMIN_EMAILS, encrypted with APP_SECRET (protects against losing the Railway volume).
 * Restore with: node scripts/restore-backup.mjs <file.pmai> <APP_SECRET>  (see the script).
 */
export const KEEP_DAYS = 7;
export const EVERY_HOURS = 24;
export const MAX_EMAIL_BYTES = 35 * 1024 * 1024; // Resend allows 40 MB per email including encoding overhead
const MAGIC = Buffer.from("PMAIBK1");

export function backupDir(): string {
  return path.join(path.dirname(path.resolve(process.env.DATABASE_PATH || "./data/agentproof.db")), "backups");
}

/** Consistent, compressed copy of the live database. */
export function snapshot(): Buffer {
  const tmp = path.join(backupDir(), `.snapshot-${process.pid}-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  try {
    getDb().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    return zlib.gzipSync(fs.readFileSync(tmp), { level: 6 });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function key(secret: string): Buffer {
  return crypto.createHash("sha256").update(`proofmyai-backup:${secret}`).digest();
}

/** AES-256-GCM: MAGIC | iv(12) | tag(16) | ciphertext. */
export function encryptBackup(data: Buffer, secret: string): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function decryptBackup(file: Buffer, secret: string): Buffer {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a ProofMyAI backup file.");
  const iv = file.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = file.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const d = crypto.createDecipheriv("aes-256-gcm", key(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(file.subarray(MAGIC.length + 28)), d.final()]);
}

export interface BackupFile { name: string; bytes: number; at: string }

export function listBackups(): BackupFile[] {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^proofmyai-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(f)).sort().reverse()
    .map((name) => { const st = fs.statSync(path.join(dir, name)); return { name, bytes: st.size, at: st.mtime.toISOString() }; });
}

export function backupPath(name: string): string | null {
  return /^proofmyai-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(name) && fs.existsSync(path.join(backupDir(), name)) ? path.join(backupDir(), name) : null;
}

export const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function lastBackup(): { at: string; ok: boolean; detail: string | null } | null {
  const r = get<{ last_run_at: string; ok: number; detail: string | null }>("SELECT last_run_at, ok, detail FROM heartbeats WHERE name = 'backup'");
  return r ? { at: r.last_run_at, ok: Boolean(r.ok), detail: r.detail } : null;
}

export function backupDue(now = new Date()): boolean {
  const last = lastBackup();
  return !last || now.getTime() - Date.parse(last.at) >= (last.ok ? EVERY_HOURS : 1) * 3600000; // retry hourly after a failure
}

function record(ok: boolean, detail: string, now: Date): void {
  run("INSERT INTO heartbeats (name, last_run_at, ok, detail) VALUES ('backup', ?, ?, ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at, ok = excluded.ok, detail = excluded.detail", now.toISOString(), ok ? 1 : 0, detail.slice(0, 300));
}

let running = false;

/** Makes today's backup, prunes old ones and emails the encrypted copy. */
export async function runBackup(now = new Date(), opts: { email?: boolean } = {}): Promise<{ ok: boolean; file?: string; bytes?: number; emailed: number; detail: string }> {
  if (running) return { ok: false, emailed: 0, detail: "A backup is already running." };
  running = true;
  try {
    const day = now.toISOString().slice(0, 10);
    const gz = snapshot();
    const name = `proofmyai-${day}.db.gz`;
    const dir = backupDir();
    fs.writeFileSync(path.join(dir, `${name}.part`), gz);
    fs.renameSync(path.join(dir, `${name}.part`), path.join(dir, name));
    for (const old of listBackups().slice(KEEP_DAYS)) fs.rmSync(path.join(dir, old.name), { force: true });

    let emailed = 0;
    let note = "";
    const secret = process.env.APP_SECRET;
    if (opts.email !== false && adminEmails().length) {
      if (!secret) note = "not emailed: APP_SECRET is not set";
      else {
        const enc = encryptBackup(gz, secret);
        const big = enc.length > MAX_EMAIL_BYTES;
        const url = `${(process.env.APP_URL || SITE_URL).replace(/\/+$/, "")}/app/admin#system`;
        emailed = await emailAdmins(systemEmail(`🗄️ Daily backup ${day} · ProofMyAI`, {
          icon: "🗄️", tone: "ok", title: big ? "Backup saved (too big to attach)" : "Your daily backup is attached",
          paragraphs: big
            ? [`Today's backup is ${sizeLabel(enc.length)}, which is too big for email. It's saved on the server; download it from the admin page.`]
            : ["Keep this email. The attached file is a complete, encrypted copy of the ProofMyAI database, so you can restore everything if the server is ever lost.", "Only someone with your APP_SECRET (in Railway → Variables) can open it. Save APP_SECRET in your password manager too.", "Your privacy policy promises deleted data leaves backups within 30 days, so delete backup emails older than 30 days."],
          facts: [["Date", day], ["Size", sizeLabel(enc.length)], ["Kept on server", `Last ${KEEP_DAYS} days`], ["Restore", "node scripts/restore-backup.mjs <file> <APP_SECRET>"]],
          cta: { label: "Open backups", url },
        }), big ? undefined : [{ filename: `proofmyai-backup-${day}.pmai`, content: enc }]);
        if (!emailed) note = "not emailed (email not configured or failed)";
      }
    }
    const detail = `${sizeLabel(gz.length)}${emailed ? `, emailed to ${emailed}` : note ? `, ${note}` : ""}`;
    record(true, detail, now);
    return { ok: true, file: name, bytes: gz.length, emailed, detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    record(false, detail, now);
    await reportError("backup", err, now);
    await emailAdmins(systemEmail("🔴 Backup failed · ProofMyAI", { icon: "🗄️", tone: "bad", title: "Today's database backup failed", paragraphs: [`Error: ${detail}`, "It will be retried automatically in an hour. If this keeps happening, check the Railway volume isn't full."] }));
    return { ok: false, emailed: 0, detail };
  } finally {
    running = false;
  }
}
