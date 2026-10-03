#!/usr/bin/env node
/**
 * Turns a ProofMyAI backup into a normal SQLite database file.
 *
 *   node scripts/restore-backup.mjs proofmyai-backup-2026-10-03.pmai "<APP_SECRET>"   (emailed, encrypted)
 *   node scripts/restore-backup.mjs proofmyai-2026-10-03.db.gz                        (downloaded from Admin)
 *
 * Writes restored-proofmyai.db next to the input file. To put it live: stop the Railway service, upload the
 * file to the volume as the file named in DATABASE_PATH (delete the old -wal and -shm files), start the service.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [file, secret] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/restore-backup.mjs <backup file> [APP_SECRET]");
  process.exit(1);
}
let data = fs.readFileSync(file);
const MAGIC = Buffer.from("PMAIBK1");
if (data.subarray(0, MAGIC.length).equals(MAGIC)) {
  if (!secret) {
    console.error("This backup is encrypted. Pass your APP_SECRET as the second argument.");
    process.exit(1);
  }
  const key = crypto.createHash("sha256").update(`proofmyai-backup:${secret}`).digest();
  const d = crypto.createDecipheriv("aes-256-gcm", key, data.subarray(7, 19));
  d.setAuthTag(data.subarray(19, 35));
  try {
    data = Buffer.concat([d.update(data.subarray(35)), d.final()]);
  } catch {
    console.error("Wrong APP_SECRET (or the file is damaged).");
    process.exit(1);
  }
}
const db = zlib.gunzipSync(data);
if (!db.subarray(0, 16).toString("latin1").startsWith("SQLite format 3")) {
  console.error("The file doesn't contain a SQLite database.");
  process.exit(1);
}
const out = path.join(path.dirname(path.resolve(file)), "restored-proofmyai.db");
fs.writeFileSync(out, db);
console.log(`Restored ${(db.length / 1048576).toFixed(1)} MB to ${out}`);
