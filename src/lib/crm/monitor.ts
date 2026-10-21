import { scheduledIds } from "../billing";
import { all, get, run, transaction } from "../db";
import { raiseIncident, resolveIncidents, type NewIncident } from "../incidents";
import { logLiveEvent } from "../liveevents";
import { decrypt, safeFetch, sha256 } from "../security";
import { median } from "../workflows/monitor";
import { watchSoon } from "../watches";
import { providerById, type CrmRecord, type Fetcher } from "./providers";

/**
 * CRM monitoring: the CRM is where agents and automations write their results, so it shows whether they worked.
 * Read-only. Only hashes of emails/phones (for duplicate detection), "is this field filled?" flags and timestamps
 * are stored, never names, emails or phone numbers.
 */
export interface CrmSource {
  id: number; project_id: number; provider: string; name: string; creds_enc: string | null;
  required_fields: string; followup_hours: number; fails: number; last_polled_at: string | null; last_error: string | null; created_at: string;
}

export const REQUIRED_OPTIONS = [["email_or_phone", "Email or phone"], ["email", "Email"], ["phone", "Phone"], ["name", "Name"], ["owner", "Owner"]] as const;
export const FOLLOWUP_OPTIONS = [0, 1, 4, 24, 48] as const;
const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();
const ago = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 120 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`;
};
const plural = (n: number, w: string) => `${n.toLocaleString("en-GB")} ${w}${n === 1 ? "" : "s"}`;

const hashOf = (projectId: number, kind: "e" | "p", v: string | null) => {
  if (!v) return null;
  const norm = kind === "e" ? v.trim().toLowerCase() : v.replace(/\D/g, "").slice(-10);
  return norm.length >= (kind === "e" ? 3 : 7) ? sha256(`crm:${projectId}:${kind}:${norm}`) : null;
};

type Row = { has_email: number; has_phone: number; has_name: number; has_owner: number };
function missingRequired(r: Row, required: string[]): boolean {
  return required.some((f) =>
    f === "email_or_phone" ? !r.has_email && !r.has_phone : f === "email" ? !r.has_email : f === "phone" ? !r.has_phone : f === "name" ? !r.has_name : f === "owner" ? !r.has_owner : false);
}

export interface IngestSummary { fetched: number; created: number; duplicates: number }

/** Stores what changed and runs every check. `first` = the initial import (nothing in it counts as "new"). */
export async function ingestCrmRecords(src: CrmSource, records: CrmRecord[], opts: { capped?: boolean; first?: boolean; now?: Date } = {}): Promise<IngestSummary> {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  watchSoon(src.project_id);
  const key = `crm:${src.id}`;
  /** Raises an incident and, when it is new, shows it in Live tracking. */
  const problem = async (inc: NewIncident) => {
    if (await raiseIncident(src.project_id, inc)) logLiveEvent(src.project_id, "crm", inc.severity === "high" ? "bad" : "warn", inc.title, inc.detail, now);
  };
  /** Resolves an incident and, when one was open, shows "fixed" in Live tracking. */
  const fixed = (suffix: string, what: string) => {
    if (!get("SELECT 1 FROM incidents WHERE project_id = ? AND dedupe_key = ? AND resolved = 0", src.project_id, `${key}:${suffix}`)) return;
    resolveIncidents(src.project_id, `${key}:${suffix}`);
    logLiveEvent(src.project_id, "crm", "ok", `${src.name}: ${what}`, "Fixed. ProofMyAI will keep watching.", now);
  };
  let created = 0;
  let duplicates = 0;
  transaction(() => {
    for (const r of records) {
      const existing = get("SELECT 1 FROM crm_records WHERE source_id = ? AND external_id = ?", src.id, r.id);
      const eh = hashOf(src.project_id, "e", r.email), ph = hashOf(src.project_id, "p", r.phone);
      if (!existing && !opts.first) {
        created++;
        if ((eh && get("SELECT 1 FROM crm_records WHERE source_id = ? AND email_hash = ?", src.id, eh)) || (ph && get("SELECT 1 FROM crm_records WHERE source_id = ? AND phone_hash = ?", src.id, ph))) duplicates++;
      }
      run(
        `INSERT INTO crm_records (source_id, external_id, kind, email_hash, phone_hash, has_email, has_phone, has_name, has_owner, created_at, updated_at, last_activity_at, activity_known, first_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source_id, external_id) DO UPDATE SET email_hash = excluded.email_hash, phone_hash = excluded.phone_hash, has_email = excluded.has_email,
           has_phone = excluded.has_phone, has_name = excluded.has_name, has_owner = excluded.has_owner, updated_at = excluded.updated_at,
           last_activity_at = excluded.last_activity_at, activity_known = excluded.activity_known`,
        src.id, r.id, r.kind, eh, ph, r.email ? 1 : 0, r.phone ? 1 : 0, r.name ? 1 : 0, r.owner ? 1 : 0,
        r.createdAt ?? at, r.updatedAt ?? r.createdAt ?? at, r.lastActivityAt ?? null, r.lastActivityAt === undefined ? 0 : 1, at,
      );
    }
    run("INSERT INTO crm_polls (source_id, at, updated, created, capped) VALUES (?, ?, ?, ?, ?)", src.id, at, records.length, created, opts.capped ? 1 : 0);
  });
  run("DELETE FROM crm_polls WHERE source_id = ? AND at < ?", src.id, iso(now.getTime() - 30 * DAY));

  // 1. Duplicates: the same email or phone created again (an automation running twice, a form submitted twice).
  if (duplicates >= 3 || (duplicates >= 2 && duplicates >= created * 0.2)) {
    await problem({
      module: "workflows", code: "CRM_DUPLICATES", severity: "medium",
      title: `${plural(duplicates, "duplicate record")} created in ${src.name}`,
      detail: `${duplicates} of the ${created} new records have the same email or phone as an existing record. An automation may be running twice, retrying after a timeout, or a form may be submitting twice. Merge them before they split your reporting and follow-ups.`,
      dedupeKey: `${key}:dupes`,
    });
  }

  // 2. Bulk changes: far more records changed than normal (a runaway automation, a bad import or an AI agent).
  if (!opts.first) {
    const history = all<{ updated: number }>("SELECT updated FROM crm_polls WHERE source_id = ? AND at >= ? AND at < ? ORDER BY at", src.id, iso(now.getTime() - 7 * DAY), at).map((p) => p.updated);
    const typical = median(history);
    const limit = Math.max(100, typical * 10);
    if (history.length >= 12 && records.length >= limit) {
      await problem({
        module: "workflows", code: "CRM_BULK_CHANGE", severity: "high",
        title: `${opts.capped ? `${records.length}+` : records.length} records changed at once in ${src.name}`,
        detail: `Usually about ${Math.round(typical)} change between checks. A runaway automation, a bad import or an AI agent may be editing records in bulk. Check the CRM's audit log and pause the automation if it isn't expected.`,
        dedupeKey: `${key}:bulk`,
      });
    } else if (records.length < limit / 2) fixed("bulk", "bulk changes stopped");
  }

  // 3. New records arriving with empty key fields (a sync mapping broke, a form field was renamed).
  const required = src.required_fields.split(",").filter(Boolean);
  if (required.length) {
    const recent = all<Row>("SELECT has_email, has_phone, has_name, has_owner FROM crm_records WHERE source_id = ? AND created_at >= ?", src.id, iso(now.getTime() - DAY));
    const older = all<Row>("SELECT has_email, has_phone, has_name, has_owner FROM crm_records WHERE source_id = ? AND created_at < ? AND created_at >= ?", src.id, iso(now.getTime() - DAY), iso(now.getTime() - 30 * DAY));
    const share = (rows: Row[]) => (rows.length ? rows.filter((r) => missingRequired(r, required)).length / rows.length : 0);
    const s = share(recent), base = share(older);
    const missing = recent.filter((r) => missingRequired(r, required)).length;
    const labels = required.map((f) => REQUIRED_OPTIONS.find(([k]) => k === f)?.[1].toLowerCase() ?? f).join(", ");
    if (recent.length >= 5 && s >= 0.3 && (older.length >= 20 ? base < 0.1 : s >= 0.5)) {
      await problem({
        module: "workflows", code: "CRM_FIELDS_MISSING", severity: "medium",
        title: `${plural(missing, "new record")} in ${src.name} ${missing === 1 ? "is" : "are"} missing ${labels}`,
        detail: `${Math.round(s * 100)}% of the records created in the last 24 hours are missing a required field${older.length >= 20 ? ` (normally ${Math.round(base * 100)}%)` : ""}. A form or sync field mapping has probably changed, so these leads can't be contacted or routed.`,
        dedupeKey: `${key}:fields`,
      });
    } else if (s < 0.1) fixed("fields", "new records have their required fields again");
  }

  // 4. New leads nobody followed up (only CRMs that report last activity).
  if (src.followup_hours > 0) {
    const waiting = get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM crm_records WHERE source_id = ? AND activity_known = 1 AND last_activity_at IS NULL AND created_at >= ? AND created_at <= ? AND kind <> 'deal'",
      src.id, iso(now.getTime() - 7 * DAY), iso(now.getTime() - src.followup_hours * 3600000),
    )?.n ?? 0;
    if (waiting > 0) {
      await problem({
        module: "workflows", code: "CRM_NO_FOLLOWUP", severity: "medium",
        title: `${plural(waiting, "new lead")} in ${src.name} not contacted within ${src.followup_hours}h`,
        detail: `They were created more than ${src.followup_hours} hours ago (in the last 7 days) and have no call, email or activity logged. The follow-up automation or the person who should call them may have stopped.`,
        dedupeKey: `${key}:followup`,
      });
    } else fixed("followup", "every new lead has been contacted");
  }

  // 5. New records stopped arriving: learned from this CRM's own rhythm (nights and weekends included).
  const times = all<{ created_at: string }>("SELECT created_at FROM crm_records WHERE source_id = ? ORDER BY created_at DESC LIMIT 51", src.id).map((t) => Date.parse(t.created_at));
  if (times.length >= 8) {
    const gaps = times.slice(1).map((t, i) => times[i] - t).filter((g) => g >= 0);
    const usual = median(gaps), longest = Math.max(...gaps);
    const limit = Math.max(longest * 1.5, usual * 3, 60 * 60000);
    const pause = now.getTime() - times[0];
    const staleKey = `${key}:stale`;
    if (usual > 0 && usual <= 7 * DAY && pause > limit) {
      const already = get("SELECT 1 FROM incidents WHERE project_id = ? AND dedupe_key = ? AND created_at >= datetime(?)", src.project_id, staleKey, iso(times[0]));
      if (!already) {
        await problem({
          module: "workflows", code: "CRM_NO_NEW_RECORDS", severity: "high",
          title: `No new records in ${src.name} for ${ago(pause)}`,
          detail: `New records normally arrive every ${ago(usual)}, and the longest normal gap was ${ago(longest)}. A website form, an ad integration or the n8n/Make flow that creates them may have stopped. Leads may be getting lost.`,
          dedupeKey: staleKey,
        });
      }
    } else fixed("stale", "new records are arriving again");
  }
  if (opts.first) logLiveEvent(src.project_id, "crm", "ok", `Connected ${src.name}`, `Read ${plural(records.length, "recently changed record")}. Checked every 15 minutes.`, now);
  else if (created > 0) logLiveEvent(src.project_id, "crm", "ok", `${src.name}: +${plural(created, "new record")}`, duplicates ? `${duplicates} look like duplicates.` : `${records.length} changed in total.`, now);
  return { fetched: records.length, created, duplicates };
}

/** Reads one CRM. Two failures in a row raise an alert, so monitoring never silently stops. */
export async function pollCrm(src: CrmSource, fetcher: Fetcher = safeFetch, now = new Date()): Promise<{ summary: IngestSummary | null; error: string | null }> {
  const provider = providerById(src.provider);
  if (!provider?.fetch || !src.creds_enc) return { summary: null, error: null };
  const first = !src.last_polled_at;
  const since = first ? iso(now.getTime() - 7 * DAY) : iso(Date.parse(src.last_polled_at!) - 10 * 60000);
  const connKey = `crm:${src.id}:conn`;
  try {
    const result = await provider.fetch(JSON.parse(decrypt(src.creds_enc)), since, fetcher);
    const summary = await ingestCrmRecords(src, result.records, { capped: result.capped, first, now });
    run("UPDATE crm_sources SET last_polled_at = ?, last_error = NULL, fails = 0 WHERE id = ?", now.toISOString(), src.id);
    if (get("SELECT 1 FROM incidents WHERE project_id = ? AND dedupe_key = ? AND resolved = 0", src.project_id, connKey)) {
      resolveIncidents(src.project_id, connKey);
      logLiveEvent(src.project_id, "crm", "ok", `${src.name}: connection restored`, "ProofMyAI can read the CRM again.", now);
    }
    return { summary, error: null };
  } catch (err) {
    const error = (err instanceof Error ? err.message : "Unknown error").slice(0, 300);
    run("UPDATE crm_sources SET last_error = ?, fails = fails + 1 WHERE id = ?", error, src.id);
    if (src.fails + 1 >= 2) {
      const raised = await raiseIncident(src.project_id, {
        module: "workflows", code: "CRM_UNREACHABLE", severity: "high",
        title: `ProofMyAI can't read ${src.name}`, detail: `${error} Until this is fixed, problems in this CRM are not being monitored.`, dedupeKey: connKey,
      });
      if (raised) logLiveEvent(src.project_id, "crm", "bad", `ProofMyAI can't read ${src.name}`, error, now);
    }
    return { summary: null, error };
  }
}

export async function pollAllCrms(now = new Date()): Promise<void> {
  const sources = all<CrmSource>(
    "SELECT s.* FROM crm_sources s JOIN projects p ON p.id = s.project_id WHERE p.is_demo = 0 AND s.provider <> 'push'",
  );
  // Records nobody has touched for 180 days are no longer needed for any check.
  run("DELETE FROM crm_records WHERE updated_at < ?", iso(now.getTime() - 180 * DAY));
  const allowed = scheduledIds("crm");
  for (const s of sources) if (!allowed || allowed.has(s.id)) await pollCrm(s, safeFetch, now);
}

/** Pushed records (any CRM via n8n, Make or Zapier). The source is created on first use. */
export async function pushCrmRecords(projectId: number, name: string, records: CrmRecord[], now = new Date()): Promise<IngestSummary> {
  let src = get<CrmSource>("SELECT * FROM crm_sources WHERE project_id = ? AND provider = 'push' AND name = ?", projectId, name);
  if (!src) {
    const id = run("INSERT INTO crm_sources (project_id, provider, name, created_at) VALUES (?, 'push', ?, ?)", projectId, name, now.toISOString()).lastInsertRowid;
    src = get<CrmSource>("SELECT * FROM crm_sources WHERE id = ?", id)!;
  }
  const summary = await ingestCrmRecords(src, records, { now });
  run("UPDATE crm_sources SET last_polled_at = ? WHERE id = ?", now.toISOString(), src.id);
  return summary;
}
