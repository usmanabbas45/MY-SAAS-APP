import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }[] = [];
vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async (to: string, mail: { subject: string; text: string }, opts: { attachments?: { filename: string; content: Buffer }[] } = {}) => {
    sent.push({ to, subject: mail.subject, text: mail.text, attachments: opts.attachments });
    return true;
  }),
  fromAddress: () => "ProofMyAI <alerts@proofmyai.com>",
}));

import { get, openDatabase, run, setDb } from "@/lib/db";
import { backupDue, decryptBackup, listBackups, runBackup, KEEP_DAYS } from "@/lib/backup";
import { checkCronHealth, errorCount, purgeOldErrors, reportError, SPIKE_ERRORS } from "@/lib/monitoring";
import { confirmEmail, isVerified, sendVerification } from "@/lib/verify";
import { recordCronRun } from "@/lib/status";
import { freshDb } from "./helpers";

let userId: number;
let dir: string;
const env = { ...process.env };
beforeEach(() => {
  ({ userId } = freshDb());
  sent.length = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pmai-ops-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.ADMIN_EMAILS = "owner@proofmyai.com";
  process.env.APP_SECRET = "test-secret-123";
  process.env.RESEND_API_KEY = "re_test";
  process.env.APP_URL = "https://proofmyai.com";
});
afterEach(() => {
  process.env = { ...env };
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("email verification", () => {
  it("existing accounts are grandfathered as verified when the column is added", () => {
    const file = path.join(dir, "old.db");
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    old.exec("INSERT INTO users (email, password_hash) VALUES ('early@shop.com', 'x')");
    old.close();
    setDb(openDatabase(file));
    expect(get<{ v: string | null }>("SELECT email_verified_at AS v FROM users WHERE email = 'early@shop.com'")?.v).toBeTruthy();
    run("INSERT INTO users (email, password_hash) VALUES ('new@shop.com', 'x')");
    expect(get<{ v: string | null }>("SELECT email_verified_at AS v FROM users WHERE email = 'new@shop.com'")?.v).toBeNull();
  });

  it("sends a link that confirms the email once", async () => {
    expect(isVerified(userId)).toBe(false);
    expect(await sendVerification(userId)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("t@example.com");
    const token = /verify-email\?token=([\w-]+)/.exec(sent[0].text)![1];
    expect(confirmEmail("wrong-token-wrong-token-1234")).toBeNull();
    expect(confirmEmail(token)).toBe(userId);
    expect(isVerified(userId)).toBe(true);
    expect(confirmEmail(token)).toBeNull(); // used
    expect(await sendVerification(userId)).toBe("already");
  });

  it("a new link replaces the old one, and expired links fail", async () => {
    await sendVerification(userId);
    await sendVerification(userId);
    const [first, second] = sent.map((m) => /token=([\w-]+)/.exec(m.text)![1]);
    expect(confirmEmail(first)).toBeNull();
    run("UPDATE email_verifications SET expires_at = '2000-01-01T00:00:00Z'");
    expect(confirmEmail(second)).toBeNull();
    expect(isVerified(userId)).toBe(false);
  });

  it("verifies automatically when email isn't configured", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendVerification(userId)).toBe("verified");
    expect(isVerified(userId)).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe("error alerts", () => {
  it("emails the admins once when errors spike, then waits an hour", async () => {
    const t = new Date("2026-10-03T10:00:00Z");
    for (let i = 0; i < SPIKE_ERRORS - 1; i++) await reportError("GET /app", new Error(`boom ${i}`), t);
    expect(sent).toHaveLength(0);
    await reportError("GET /app", new Error("boom last"), t);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "owner@proofmyai.com" });
    expect(sent[0].subject).toMatch(/5 server errors/);
    expect(sent[0].text).toContain("boom last");
    for (let i = 0; i < 10; i++) await reportError("GET /app", new Error("more"), new Date(t.getTime() + 30 * 60000));
    expect(sent).toHaveLength(1);
    for (let i = 0; i < SPIKE_ERRORS; i++) await reportError("GET /app", new Error("later"), new Date(t.getTime() + 61 * 60000));
    expect(sent).toHaveLength(2);
    expect(errorCount(24, new Date(t.getTime() + 62 * 60000))).toBe(20);
    expect(purgeOldErrors(30, new Date(t.getTime() + 31 * 86400000))).toBe(20);
  });

  it("ignores redirects and not-found (they aren't errors)", async () => {
    for (let i = 0; i < 10; i++) await reportError("POST /x", Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/app;307;" }));
    expect(errorCount(1)).toBe(0);
  });

  it("alerts when background checks stop and when they recover", async () => {
    const t = new Date("2026-10-03T10:00:00Z");
    expect(await checkCronHealth(t)).toBe("unknown");
    recordCronRun(true, "", t);
    expect(await checkCronHealth(new Date(t.getTime() + 20 * 60000))).toBe("ok");
    expect(await checkCronHealth(new Date(t.getTime() + 50 * 60000))).toBe("alerted");
    expect(await checkCronHealth(new Date(t.getTime() + 60 * 60000))).toBe("late"); // no repeat
    expect(sent.map((m) => m.subject)).toEqual([expect.stringMatching(/stopped/)]);
    recordCronRun(true, "", new Date(t.getTime() + 70 * 60000));
    expect(await checkCronHealth(new Date(t.getTime() + 71 * 60000))).toBe("recovered");
    expect(sent[1].subject).toMatch(/running again/);
  });
});

describe("backups", () => {
  it("makes a restorable, encrypted backup and emails it", async () => {
    run("INSERT INTO projects (user_id, name, api_key) VALUES (?, 'Backup me', 'ap_live_b')", userId);
    expect(backupDue()).toBe(true);
    const r = await runBackup(new Date("2026-10-03T03:00:00Z"));
    expect(r).toMatchObject({ ok: true, file: "proofmyai-2026-10-03.db.gz", emailed: 1 });
    expect(backupDue(new Date("2026-10-03T20:00:00Z"))).toBe(false);
    expect(backupDue(new Date("2026-10-04T03:01:00Z"))).toBe(true);

    const att = sent[0].attachments![0];
    expect(att.filename).toBe("proofmyai-backup-2026-10-03.pmai");
    expect(() => decryptBackup(att.content, "wrong")).toThrow();
    const restored = path.join(dir, "restored.db");
    fs.writeFileSync(restored, zlib.gunzipSync(decryptBackup(att.content, "test-secret-123")));
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(restored);
    expect(db.prepare("SELECT name FROM projects WHERE api_key = 'ap_live_b'").get()).toEqual({ name: "Backup me" });
    db.close();

    // the restore script gives the same result
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const enc = path.join(dir, "b.pmai");
    fs.writeFileSync(enc, att.content);
    expect(execFileSync("node", ["scripts/restore-backup.mjs", enc, "test-secret-123"]).toString()).toMatch(/Restored/);
    expect(fs.existsSync(path.join(dir, "restored-proofmyai.db"))).toBe(true);
  });

  it(`keeps only the last ${KEEP_DAYS} days`, async () => {
    for (let d = 1; d <= KEEP_DAYS + 3; d++) await runBackup(new Date(`2026-10-${String(d).padStart(2, "0")}T03:00:00Z`), { email: false });
    const files = listBackups();
    expect(files).toHaveLength(KEEP_DAYS);
    expect(files[0].name).toBe(`proofmyai-2026-10-${String(KEEP_DAYS + 3).padStart(2, "0")}.db.gz`);
    expect(sent).toHaveLength(0);
  });
});
