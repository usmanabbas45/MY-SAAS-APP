import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { breachCount } from "@/lib/breach";
import { checkCaptcha, createChallenge, leadingZeroBits, verifyPow } from "@/lib/captcha";
import { get, run } from "@/lib/db";
import { isDisposableEmail } from "@/lib/disposable";
import { checkPassword } from "@/lib/password";
import { deviceLabel, recordLogin } from "@/lib/securityevents";
import {
  base32Decode, base32Encode, confirmSetup, disableTwoFactor, matchTotp, pendingLoginToken, readPendingLogin,
  recoveryCodesLeft, startSetup, totpAt, twoFactorEnabled, verifySecondFactor,
} from "@/lib/twofactor";
import { freshDb } from "./helpers";

let userId: number;
beforeEach(() => ({ userId } = freshDb()));
afterEach(() => { delete process.env.CAPTCHA_BITS; });

function solvePow(challenge: string): string {
  const { salt, bits } = JSON.parse(Buffer.from(challenge.split(".")[0], "base64url").toString());
  for (let n = 0; ; n++) {
    if (leadingZeroBits(crypto.createHash("sha256").update(`${salt}:${n}`).digest("hex")) >= bits) return `${challenge}.${n}`;
  }
}

describe("CAPTCHA (proof of work)", () => {
  it("accepts a solved challenge once, rejects tampering, replays and expiry", async () => {
    process.env.CAPTCHA_BITS = "8";
    const token = solvePow(createChallenge());
    expect(verifyPow(token)).toBeNull();
    expect(verifyPow(token)).toBe("reused");
    const [p, , n] = solvePow(createChallenge()).split(".");
    expect(verifyPow(`${p}.forged.${n}`)).toBe("invalid");
    expect(verifyPow(solvePow(createChallenge(Date.now() - 11 * 60 * 1000)))).toBe("expired");
    expect(verifyPow("")).toBe("missing");
    const form = new FormData(); form.set("captcha", solvePow(createChallenge())); form.set("website", "http://spam");
    expect(await checkCaptcha(form, "1.2.3.4")).toMatch(/try again/);
    form.set("website", "");
    expect(await checkCaptcha(form, "1.2.3.4")).toBeNull();
  });
  it("counts leading zero bits", () => {
    expect(leadingZeroBits("0f")).toBe(4);
    expect(leadingZeroBits("00ff")).toBe(8);
    expect(leadingZeroBits("1f")).toBe(3);
  });
});

describe("passwords", () => {
  it("scores and explains", () => {
    expect(checkPassword("abc").ok).toBe(false);
    expect(checkPassword("Qwerty12345!").problem).toMatch(/common/);
    expect(checkPassword("aaaaBBBB1111!").problem).toMatch(/common/);
    const s = checkPassword("Blue-Tiger-42x-Moon");
    expect(s).toMatchObject({ ok: true, score: 4, label: "Strong" });
  });
  it("checks the breach database with only a hash prefix", async () => {
    const hash = crypto.createHash("sha1").update("Blue-Tiger-42x").digest("hex").toUpperCase();
    const fetcher = vi.fn(async (url: string) => new Response(`${hash.slice(5)}:1234\nAAAA:1`));
    expect(await breachCount("Blue-Tiger-42x", fetcher as unknown as typeof fetch)).toBe(1234);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(await breachCount("x", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe(0);
  });
});

describe("sign-up protection", () => {
  it("blocks disposable emails including subdomains", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@eu.mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@gmail.com")).toBe(false);
  });
});

describe("two-factor authentication", () => {
  it("matches the RFC 6238 test vectors", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(matchTotp(secret, "081 804", 1111111109 * 1000)).not.toBeNull();
    expect(matchTotp(secret, "000000", 1111111109 * 1000)).toBeNull();
  });

  it("sets up, logs in once per code, supports recovery codes and can be turned off", () => {
    const now = Date.now();
    const secret = startSetup(userId);
    expect(twoFactorEnabled(userId)).toBe(false);
    expect(confirmSetup(userId, "000000", now)).toBeNull();
    const codes = confirmSetup(userId, totpAt(secret, Math.floor(now / 30000)), now)!;
    expect(codes).toHaveLength(10);
    expect(twoFactorEnabled(userId)).toBe(true);
    expect(get<{ s: string }>("SELECT totp_secret_enc AS s FROM users WHERE id = ?", userId)!.s).not.toContain(secret);
    const later = now + 60000;
    const code = totpAt(secret, Math.floor(later / 30000));
    expect(verifySecondFactor(userId, code, later)).toEqual({ ok: true });
    expect(verifySecondFactor(userId, code, later)).toEqual({ ok: false }); // same code can't be reused
    expect(verifySecondFactor(userId, codes[0], later)).toEqual({ ok: true, usedRecovery: true });
    expect(verifySecondFactor(userId, codes[0], later)).toEqual({ ok: false });
    expect(recoveryCodesLeft(userId)).toBe(9);
    disableTwoFactor(userId);
    expect(twoFactorEnabled(userId)).toBe(false);
  });

  it("signs the pending-login step and expires it", () => {
    const t = pendingLoginToken(userId);
    expect(readPendingLogin(t)).toBe(userId);
    expect(readPendingLogin(t.replace(/^\d+/, "999"))).toBeNull();
    expect(readPendingLogin(pendingLoginToken(userId, Date.now() - 6 * 60 * 1000))).toBeNull();
  });
});

describe("new-device alerts", () => {
  it("labels devices and alerts only for new ones after the first", async () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(deviceLabel(chrome)).toBe("Chrome on Windows");
    expect(deviceLabel(iphone)).toBe("Safari on iPhone");
    expect(await recordLogin(userId, "t@example.com", chrome, "1.1.1.1")).toBe(false); // first device: no alert
    expect(await recordLogin(userId, "t@example.com", chrome, "2.2.2.2")).toBe(false); // known device
    expect(await recordLogin(userId, "t@example.com", iphone, "3.3.3.3")).toBe(true); // new device: alert
    run("DELETE FROM login_devices");
  });
});
