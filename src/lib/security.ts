import crypto from "node:crypto";
import dns from "node:dns/promises";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET must be set (16+ characters) in production");
  }
  return "dev-only-insecure-secret-change-me";
}

/** A stable, non-secret identifier derived from the app secret (one-way), e.g. the IndexNow key. */
export function derivedKey(label: string): string {
  return sha256(`${label}:${appSecret()}`).slice(0, 32);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function encryptionKey(): Buffer {
  return crypto.createHash("sha256").update(`enc:${appSecret()}`).digest();
}

/** AES-256-GCM encryption for third-party credentials stored in the database. */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Address ranges a customer-supplied URL must never reach (loopback, private, link-local, metadata, reserved). */
const BLOCKED = (() => {
  const b = new net.BlockList();
  for (const [ip, bits] of [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
    ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ] as const) b.addSubnet(ip, bits, "ipv4");
  for (const [ip, bits] of [
    ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32],
    ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
  ] as const) b.addSubnet(ip, bits, "ipv6");
  return b;
})();

/** IPv4 address hidden inside an IPv6 one (::ffff:a.b.c.d, ::ffff:7f00:1, ::a.b.c.d, 6to4 2002:AABB:CCDD::). */
function embeddedIpv4(v6: string): string | null {
  const dotted = v6.match(/^(?:0*:)*:?(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];
  const hex = v6.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  const sixToFour = v6.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/i);
  const m = hex ?? sixToFour;
  if (!m) return null;
  const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

export function isPrivateAddress(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(host)) return BLOCKED.check(host, "ipv4");
  if (!net.isIPv6(host)) return true; // not an IP at all: refuse rather than guess
  const v4 = embeddedIpv4(host.toLowerCase());
  if (v4 && net.isIPv4(v4) && BLOCKED.check(v4, "ipv4")) return true;
  return BLOCKED.check(host, "ipv6");
}

/**
 * Guards server-side fetches of customer-supplied URLs (bot endpoints, n8n/Make hosts)
 * against SSRF into our own network. Self-hosters can opt out with ALLOW_PRIVATE_URLS=true.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are allowed");
  if (process.env.ALLOW_PRIVATE_URLS === "true") return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("URL points to a private or local network address");
  }
  return url;
}

/**
 * DNS lookup used for every outbound connection to customer systems: the address is checked at the
 * moment of connecting, so a hostname can't pass the first check and then switch to an internal
 * address (DNS rebinding).
 */
function guardedLookup(hostname: string, options: object, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    if (process.env.ALLOW_PRIVATE_URLS !== "true" && (list.length === 0 || list.some((a) => isPrivateAddress(a.address)))) {
      return callback(Object.assign(new Error("URL points to a private or local network address"), { code: "EPRIVATE" }), []);
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export const guardedAgent = new Agent({ connect: { lookup: guardedLookup as never }, headersTimeout: 60000, bodyTimeout: 60000 });

/** fetch() with a timeout and SSRF protection, used for every outbound call to customer systems. */
export async function safeFetch(url: string, init: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  await assertPublicUrl(url);
  const res = await undiciFetch(url, { ...(init as object), redirect: "error", signal: AbortSignal.timeout(timeoutMs), dispatcher: guardedAgent } as never);
  return res as unknown as Response;
}

const buckets = new Map<string, { count: number; reset: number }>();

/** Simple in-memory fixed-window rate limiter (per process). Returns false when the limit is exceeded. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 10000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    return true;
  }
  b.count++;
  return b.count <= max;
}
