import { get, run } from "./db";
import { sendMail } from "./email";
import { securityEmail } from "./emails";
import { sha256 } from "./security";

/** "Chrome on Windows", "Safari on iPhone"… from a User-Agent header. */
export function deviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "an unknown device";
  return `${browser} on ${os}`;
}

const when = () => new Date().toUTCString().replace(" GMT", " UTC");

/** Remembers the device and emails the user when they sign in from a new one (never on their very first device). */
export async function recordLogin(userId: number, email: string, userAgent: string, ip: string): Promise<boolean> {
  const label = deviceLabel(userAgent);
  const hash = sha256(`${userId}:${label}`);
  const known = get("SELECT 1 FROM login_devices WHERE user_id = ? AND device_hash = ?", userId, hash);
  const hasAny = get("SELECT 1 FROM login_devices WHERE user_id = ?", userId);
  run(
    "INSERT INTO login_devices (user_id, device_hash, label) VALUES (?, ?, ?) ON CONFLICT(user_id, device_hash) DO UPDATE SET last_seen = datetime('now')",
    userId, hash, label,
  );
  if (known || !hasAny) return false;
  await sendMail(email, securityEmail("new_login", [["💻 Device", label], ["🌐 IP address", ip || "unknown"], ["🕒 Time", when()]]), { fromName: "ProofMyAI Security" }).catch(() => false);
  return true;
}

export async function securityNotice(email: string, kind: "password_changed" | "2fa_on" | "2fa_off" | "recovery_used", ip = "", userAgent = ""): Promise<void> {
  const facts: [string, string][] = [["🕒 Time", when()]];
  if (userAgent) facts.unshift(["💻 Device", deviceLabel(userAgent)]);
  if (ip) facts.unshift(["🌐 IP address", ip]);
  await sendMail(email, securityEmail(kind, facts), { fromName: "ProofMyAI Security" }).catch(() => false);
}
