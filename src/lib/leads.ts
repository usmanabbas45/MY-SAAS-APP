import { all, get, run } from "./db";
import { channelOf, type Attribution } from "./attribution";

/** Leads from the free-audit request form (and future lead magnets), for the admin to follow up. */

export type LeadKind = "audit_request";
export const LEAD_STATUSES = ["new", "contacted", "converted", "not_a_fit"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", converted: "Became a customer", not_a_fit: "Not a fit" };

export interface Lead {
  id: number; kind: LeadKind; email: string; name: string | null; website: string | null; platform: string | null;
  message: string | null; channel: string | null; source: string | null; campaign: string | null; status: LeadStatus; created_at: string;
}

export function addLead(l: { kind: LeadKind; email: string; name?: string; website?: string; platform?: string; message?: string }, attr: Attribution | null): number {
  const r = run(
    "INSERT INTO leads (kind, email, name, website, platform, message, channel, source, campaign) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    l.kind, l.email.toLowerCase(), l.name || null, l.website || null, l.platform || null, l.message || null,
    channelOf(attr), attr?.source ?? attr?.referrer ?? null, attr?.campaign ?? null,
  );
  return Number(r.lastInsertRowid);
}

/** True when the same email asked in the last 24 hours (stops duplicates and form spam). */
export function recentLeadExists(email: string): boolean {
  return Boolean(get("SELECT 1 FROM leads WHERE email = ? AND created_at >= datetime('now', '-1 day')", email.toLowerCase()));
}

export function listLeads(status?: LeadStatus, limit = 200): Lead[] {
  return status
    ? all<Lead>("SELECT * FROM leads WHERE status = ? ORDER BY id DESC LIMIT ?", status, limit)
    : all<Lead>("SELECT * FROM leads ORDER BY id DESC LIMIT ?", limit);
}

export function leadCounts(): Record<LeadStatus | "all", number> {
  const rows = all<{ status: LeadStatus; n: number }>("SELECT status, COUNT(*) AS n FROM leads GROUP BY status");
  const out = { all: 0, new: 0, contacted: 0, converted: 0, not_a_fit: 0 };
  for (const r of rows) { out[r.status] = r.n; out.all += r.n; }
  return out;
}

export function setLeadStatus(id: number, status: LeadStatus): void {
  run("UPDATE leads SET status = ? WHERE id = ?", status, id);
}
