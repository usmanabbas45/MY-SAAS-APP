import { beforeEach, describe, expect, it } from "vitest";
import { activeSessions, changePassword, deleteAccount, passwordProblem, requestPasswordReset, resetPassword, resetTokenValid, signOutOtherDevices } from "@/lib/account";
import { all, get, run } from "@/lib/db";
import { hashPassword, sha256, verifyPassword } from "@/lib/security";
import { freshDb } from "./helpers";

let userId: number;
let projectId: number;
const pw = () => get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", userId)!.password_hash;
const addSession = (token: string) =>
  run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", sha256(token), userId, new Date(Date.now() + 86400e3).toISOString());

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  ({ userId, projectId } = freshDb());
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword("oldpassword1"), userId);
});

describe("password reset", () => {
  it("issues a single-use token for known emails only", async () => {
    expect((await requestPasswordReset("nobody@example.com", "https://proofmyai.com")).token).toBeNull();
    const { token } = await requestPasswordReset("T@Example.com ", "https://proofmyai.com");
    expect(token).toBeTruthy();
    expect(resetTokenValid(token!)).toBe(true);
    // stored hashed, never in plain text
    expect(get("SELECT 1 FROM password_resets WHERE token_hash = ?", token!)).toBeUndefined();
  });

  it("resets the password, signs out everywhere and cannot be reused", async () => {
    addSession("device-a");
    const { token } = await requestPasswordReset("t@example.com", "https://x");
    expect(resetPassword(token!, "short")).toMatchObject({ ok: false });
    expect(resetPassword(token!, "Brand-New-Pass1")).toMatchObject({ ok: true });
    expect(verifyPassword("Brand-New-Pass1", pw())).toBe(true);
    expect(activeSessions(userId)).toBe(0);
    expect(resetPassword(token!, "Another-Pass12")).toMatchObject({ ok: false });
    expect(resetTokenValid(token!)).toBe(false);
  });

  it("rejects expired and unknown tokens", async () => {
    const { token } = await requestPasswordReset("t@example.com", "https://x");
    run("UPDATE password_resets SET expires_at = ?", new Date(Date.now() - 1000).toISOString());
    expect(resetTokenValid(token!)).toBe(false);
    expect(resetPassword(token!, "Brand-New-Pass1")).toMatchObject({ ok: false });
    expect(resetPassword("made-up-token", "Brand-New-Pass1")).toMatchObject({ ok: false });
  });

  it("a new request replaces older tokens", async () => {
    const a = (await requestPasswordReset("t@example.com", "https://x")).token!;
    const b = (await requestPasswordReset("t@example.com", "https://x")).token!;
    expect(resetTokenValid(a)).toBe(false);
    expect(resetTokenValid(b)).toBe(true);
  });
});

describe("account settings", () => {
  it("changes the password only with the right current password, keeping this device", () => {
    addSession("this-device");
    addSession("other-device");
    expect(changePassword(userId, "wrong", "New-Secure-Pass9", sha256("this-device"))).toMatch(/current password is wrong/);
    expect(changePassword(userId, "oldpassword1", "short", sha256("this-device"))).toMatch(/at least 10/);
    expect(changePassword(userId, "oldpassword1", "New-Secure-Pass9", sha256("this-device"))).toBeNull();
    expect(verifyPassword("New-Secure-Pass9", pw())).toBe(true);
    expect(all("SELECT token_hash FROM sessions WHERE user_id = ?", userId)).toEqual([{ token_hash: sha256("this-device") }]);
  });

  it("signs out other devices", () => {
    addSession("a"); addSession("b"); addSession("c");
    expect(signOutOtherDevices(userId, sha256("a"))).toBe(2);
    expect(activeSessions(userId)).toBe(1);
  });

  it("deletes the account and all its data only with the right password", () => {
    run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 't', 'c')", projectId);
    expect(deleteAccount(userId, "nope")).toMatch(/Wrong password/);
    expect(get("SELECT id FROM users WHERE id = ?", userId)).toBeTruthy();
    expect(deleteAccount(userId, "oldpassword1")).toBeNull();
    expect(get("SELECT id FROM users WHERE id = ?", userId)).toBeUndefined();
    expect(all("SELECT id FROM projects")).toHaveLength(0);
    expect(all("SELECT id FROM kb_docs")).toHaveLength(0);
  });

  it("requires strong passwords", () => {
    expect(passwordProblem("1234567")).toMatch(/at least 10/);
    expect(passwordProblem("Password123!")).toMatch(/common/);
    expect(passwordProblem("abcdefghijk")).toMatch(/Mix/);
    expect(passwordProblem("Blue-Tiger-42x")).toBeNull();
    expect(passwordProblem("correct horse battery staple")).toBeNull();
    expect(passwordProblem("Usman-Secure-7", "usman@example.com")).toMatch(/email name/);
    expect(passwordProblem("Aa1!" + "x".repeat(201))).toBeTruthy();
  });
});
