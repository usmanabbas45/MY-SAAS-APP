import crypto from "node:crypto";
import { run } from "./db";
import { derivedKey } from "./security";
import { SITE_URL } from "./seo";

/**
 * One-click unsubscribe for the weekly summary (no login needed). The link carries a token derived from
 * APP_SECRET, so only the real email can turn it off. Supports the List-Unsubscribe-Post one-click
 * standard (RFC 8058) that Gmail and Yahoo expect from senders.
 */
export const unsubToken = (projectId: number) => derivedKey(`unsub-digest:${projectId}`);

export function unsubUrl(projectId: number): string {
  return `${(process.env.APP_URL || SITE_URL).replace(/\/+$/, "")}/unsubscribe?p=${projectId}&t=${unsubToken(projectId)}`;
}

export function unsubHeaders(projectId: number): Record<string, string> {
  return { "List-Unsubscribe": `<${unsubUrl(projectId)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

export function validUnsub(projectId: number, token: string): boolean {
  if (!Number.isInteger(projectId) || projectId <= 0 || !token) return false;
  const a = Buffer.from(token), b = Buffer.from(unsubToken(projectId));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Turns off the weekly summary. Returns false for a wrong link. */
export function unsubscribeDigest(projectId: number, token: string): boolean {
  if (!validUnsub(projectId, token)) return false;
  run("UPDATE projects SET weekly_digest = 0 WHERE id = ?", projectId);
  return true;
}
