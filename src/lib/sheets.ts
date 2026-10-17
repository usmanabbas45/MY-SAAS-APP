import { createHash } from "node:crypto";
import { scheduledIds } from "./billing";
import { all, run } from "./db";
import { raiseIncident, resolveIncidents } from "./incidents";
import { safeFetch } from "./security";

/**
 * Google Sheets watch: reads a link-shared or published Google Sheet as CSV every 15 minutes and alerts when
 * it stops changing (an automation stopped writing to it), when cells show formula errors (#REF!, #N/A…),
 * when a required column is empty in recent rows, or when most of its rows suddenly disappear. Read-only:
 * we never write to the sheet. Incidents use the "workflows" module, since sheets are usually automation output.
 */
export interface SheetWatch {
  id: number; project_id: number; name: string; url: string; csv_url: string;
  stale_hours: number; required_col: string | null;
  status: "pending" | "ok" | "problem" | "error"; fails: number;
  last_checked_at: string | null; last_changed_at: string | null; last_hash: string | null;
  row_count: number | null; error_cells: number; blank_required: number; last_error: string | null; created_at: string;
}

export const CHECK_EVERY_MIN = 15;
export const STALE_OPTIONS = [0, 1, 3, 6, 12, 24, 48, 168] as const;
const FAILS_TO_ALERT = 2;
const RECENT_ROWS = 20;
const MAX_BYTES = 5_000_000;
const ERROR_CELL = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|ERROR!|NULL!)/;
const GOOGLE_HOSTS = /(^|\.)(google\.com|googleusercontent\.com)$/i;
type Fetcher = (url: string, init: RequestInit, timeoutMs: number) => Promise<Response>;

/** Turns any Google Sheets link (edit, share, published) into the CSV address of the same tab. */
export function sheetCsvUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (u.hostname !== "docs.google.com") return null;
  const gid = u.searchParams.get("gid") ?? new URLSearchParams(u.hash.replace(/^#/, "")).get("gid");
  const published = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)\//);
  if (published) return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gid ? `&gid=${gid}&single=true` : ""}`;
  const normal = u.pathname.match(/^\/spreadsheets\/d\/([\w-]{20,})/);
  if (normal) return `https://docs.google.com/spreadsheets/d/${normal[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
  return null;
}

/** RFC 4180 CSV parser: quoted fields, escaped quotes and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

export interface SheetSnapshot { hash: string; rows: number; errorCells: string[]; blankRequired: number; requiredFound: boolean }

/** What a CSV says: data rows (after the header, ignoring blank rows), error cells and blanks in the required column. */
export function analyseCsv(text: string, requiredCol: string | null): SheetSnapshot {
  const all = parseCsv(text);
  const isBlank = (r: string[]) => r.every((c) => c.trim() === "");
  const header = all.find((r) => !isBlank(r)) ?? [];
  const headerAt = all.indexOf(header);
  const data = all.slice(headerAt + 1).map((r, i) => ({ r, line: headerAt + 2 + i })).filter(({ r }) => !isBlank(r));
  const errorCells: string[] = [];
  for (const { r, line } of data) r.forEach((c, ci) => { if (ERROR_CELL.test(c.trim())) errorCells.push(`${colName(ci)}${line} (${c.trim()})`); });
  header.forEach((c, ci) => { if (ERROR_CELL.test(c.trim())) errorCells.push(`${colName(ci)}${headerAt + 1} (${c.trim()})`); });
  const col = requiredCol ? header.findIndex((h) => h.trim().toLowerCase() === requiredCol.trim().toLowerCase()) : -1;
  const blankRequired = col >= 0 ? data.slice(-RECENT_ROWS).filter(({ r }) => !(r[col] ?? "").trim()).length : 0;
  return { hash: createHash("sha256").update(text).digest("hex"), rows: data.length, errorCells, blankRequired, requiredFound: col >= 0 };
}

/** Downloads the CSV, following Google's redirects only within Google's own hosts (safeFetch blocks private addresses). */
export async function fetchSheetCsv(csvUrl: string, fetcher: Fetcher = safeFetch): Promise<string> {
  let current = csvUrl;
  for (let hop = 0; hop < 5; hop++) {
    const host = new URL(current).hostname;
    if (!GOOGLE_HOSTS.test(host)) throw new Error("The sheet link redirected outside Google.");
    if (/^accounts\.google\.com$/i.test(host)) throw new Error("The sheet isn't shared. In Google Sheets click Share, then set General access to \"Anyone with the link\" (Viewer).");
    const res = await fetcher(current, { redirect: "manual", headers: { "user-agent": "ProofMyAI-SheetsWatch/1.0 (+https://proofmyai.com)", accept: "text/csv,*/*" } }, 20000);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new Error(`Google answered with HTTP ${res.status} and no address.`);
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error("The sheet isn't shared. In Google Sheets click Share, then set General access to \"Anyone with the link\" (Viewer).");
    if (res.status === 404) throw new Error("Sheet not found. It may have been deleted, or the link is wrong.");
    if (res.status >= 400) throw new Error(`Google answered with HTTP ${res.status}.`);
    const type = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("This sheet is larger than 5 MB. Watch a smaller tab instead.");
    if (/text\/html/i.test(type) || /^\s*<(!doctype|html)/i.test(text)) throw new Error("The sheet isn't shared. In Google Sheets click Share, then set General access to \"Anyone with the link\" (Viewer).");
    return text;
  }
  throw new Error("Too many redirects from Google.");
}

const ageHours = (iso: string, now: Date) => (now.getTime() - Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`)) / 3600000;
const plural = (n: number, w: string) => `${n.toLocaleString("en-GB")} ${w}${n === 1 ? "" : "s"}`;
const hoursText = (h: number) => (h >= 48 && h % 24 === 0 ? plural(h / 24, "day") : plural(h, "hour"));

export interface SheetCheck { ok: boolean; problems: string[]; error: string | null; rows: number | null }

/** Runs one check, updates the watch and raises or resolves incidents. */
export async function checkSheet(w: SheetWatch, fetcher?: Fetcher, now = new Date()): Promise<SheetCheck> {
  const at = now.toISOString();
  const key = `sheet:${w.id}`;
  let text: string;
  try {
    text = await fetchSheetCsv(w.csv_url, fetcher);
  } catch (err) {
    const msg = (err instanceof Error ? (err.name === "TimeoutError" || /abort|timeout/i.test(err.message) ? "Google did not respond within 20 seconds." : err.message) : "Could not read the sheet.").slice(0, 300);
    const fails = w.fails + 1;
    const failing = fails >= FAILS_TO_ALERT;
    run("UPDATE sheet_watches SET status = ?, fails = ?, last_checked_at = ?, last_error = ? WHERE id = ?", failing ? "error" : w.status, fails, at, msg, w.id);
    if (failing) await raiseIncident(w.project_id, { module: "workflows", code: "SHEET_UNREADABLE", severity: "high", title: `Can't read the sheet "${w.name}"`, detail: msg, dedupeKey: `${key}:read` });
    return { ok: false, problems: [], error: msg, rows: null };
  }
  resolveIncidents(w.project_id, `${key}:read`);

  const s = analyseCsv(text, w.required_col);
  const changed = s.hash !== w.last_hash;
  const lastChanged = changed ? at : w.last_changed_at ?? at;
  const problems: string[] = [];

  // 1. Stopped updating.
  if (w.stale_hours > 0 && !changed && w.last_hash && ageHours(lastChanged, now) >= w.stale_hours) {
    problems.push("not updating");
    await raiseIncident(w.project_id, {
      module: "workflows", code: "SHEET_STALE", severity: "high", title: `"${w.name}" stopped updating`,
      detail: `No changes for ${hoursText(Math.floor(ageHours(lastChanged, now)))} (your limit is ${hoursText(w.stale_hours)}). The automation that writes to this sheet may have stopped. It has ${plural(s.rows, "row")}.`,
      dedupeKey: `${key}:stale`,
    });
  } else resolveIncidents(w.project_id, `${key}:stale`);

  // 2. Formula errors.
  if (s.errorCells.length) {
    problems.push("error cells");
    await raiseIncident(w.project_id, {
      module: "workflows", code: "SHEET_ERRORS", severity: "medium", title: `${plural(s.errorCells.length, "error cell")} in "${w.name}"`,
      detail: `For example ${s.errorCells.slice(0, 5).join(", ")}. Formulas or imported data are broken, so totals and reports built on this sheet are wrong.`,
      dedupeKey: `${key}:errors`,
    });
  } else resolveIncidents(w.project_id, `${key}:errors`);

  // 3. Required column empty in recent rows.
  if (w.required_col && !s.requiredFound && s.rows > 0) {
    problems.push("required column missing");
    await raiseIncident(w.project_id, {
      module: "workflows", code: "SHEET_COLUMN_MISSING", severity: "medium", title: `Column "${w.required_col}" is missing from "${w.name}"`,
      detail: `The first row no longer has a "${w.required_col}" heading. Someone may have renamed or deleted the column, or the automation now writes different fields.`,
      dedupeKey: `${key}:blank`,
    });
  } else if (s.blankRequired > 0) {
    problems.push("empty required cells");
    await raiseIncident(w.project_id, {
      module: "workflows", code: "SHEET_BLANKS", severity: "medium", title: `"${w.required_col}" is empty in ${plural(s.blankRequired, "new row")} of "${w.name}"`,
      detail: `${s.blankRequired} of the last ${Math.min(RECENT_ROWS, s.rows)} rows have no ${w.required_col}. The automation filling this sheet may be missing a field.`,
      dedupeKey: `${key}:blank`,
    });
  } else resolveIncidents(w.project_id, `${key}:blank`);

  // 4. Most rows disappeared (sheet cleared or overwritten).
  if (w.row_count != null && w.row_count >= 20 && s.rows < w.row_count * 0.5) {
    problems.push("rows disappeared");
    await raiseIncident(w.project_id, {
      module: "workflows", code: "SHEET_ROWS_DROPPED", severity: "high", title: `Rows disappeared from "${w.name}"`,
      detail: `It went from ${plural(w.row_count, "row")} to ${plural(s.rows, "row")} since the last check. Someone may have cleared the sheet, or an automation overwrote it. Check the version history in Google Sheets (File → Version history).`,
      dedupeKey: `${key}:rows`,
    });
  } // A one-off event: it stays open until someone resolves it on the Incidents page.

  run(
    `UPDATE sheet_watches SET status = ?, fails = 0, last_checked_at = ?, last_changed_at = ?, last_hash = ?, row_count = ?, error_cells = ?, blank_required = ?, last_error = NULL WHERE id = ?`,
    problems.length ? "problem" : "ok", at, lastChanged, s.hash, s.rows, s.errorCells.length, s.blankRequired, w.id,
  );
  return { ok: problems.length === 0, problems, error: null, rows: s.rows };
}

/** Checks every watch that is due. Called every minute by the background timer and by the cron as a backup. */
export async function runDueSheets(now = new Date(), fetcher?: Fetcher): Promise<number> {
  const due = all<SheetWatch>(
    `SELECT * FROM sheet_watches WHERE (last_checked_at IS NULL OR datetime(last_checked_at) <= datetime(?, '-${CHECK_EVERY_MIN * 60 - 20} seconds'))
       AND project_id NOT IN (SELECT id FROM projects WHERE is_demo = 1)`,
    now.toISOString(),
  );
  const allowed = scheduledIds("sheets");
  const allowedDue = allowed ? due.filter((w) => allowed.has(w.id)) : due;
  let n = 0;
  for (let i = 0; i < allowedDue.length; i += 5) {
    await Promise.all(allowedDue.slice(i, i + 5).map((w) => checkSheet(w, fetcher, now).then(() => n++).catch((err) => console.error("[sheets]", err))));
  }
  return n;
}
