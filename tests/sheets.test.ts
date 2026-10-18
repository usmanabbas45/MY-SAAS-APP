import { beforeEach, describe, expect, it } from "vitest";
import { usage, billingState } from "@/lib/billing";
import { all, get, run } from "@/lib/db";
import { liveFeed, sourceStatuses } from "@/lib/live";
import { analyseCsv, checkSheet, fetchSheetCsv, newestDate, parseCsv, runDueSheets, sheetCsvUrl, zonedToUtc, type SheetWatch } from "@/lib/sheets";
import { freshDb } from "./helpers";

let projectId: number;
let userId: number;
beforeEach(() => ({ projectId, userId } = freshDb()));

const csv = (body: string) => async () => new Response(body, { status: 200, headers: { "content-type": "text/csv" } });
const watch = () => get<SheetWatch>("SELECT * FROM sheet_watches WHERE project_id = ?", projectId)!;
const open = () => all<{ code: string }>("SELECT code FROM incidents WHERE project_id = ? AND resolved = 0 ORDER BY id", projectId).map((r) => r.code);
const add = (stale = 6, col: string | null = null) =>
  run("INSERT INTO sheet_watches (project_id, name, url, csv_url, stale_hours, required_col) VALUES (?, 'Leads', 'https://docs.google.com/spreadsheets/d/x/edit', 'https://docs.google.com/spreadsheets/d/x/export?format=csv', ?, ?)", projectId, stale, col);
const rows = (n: number, extra = "") => ["Name,Email,Total", ...Array.from({ length: n }, (_, i) => `Lead ${i},lead${i}@x.com,${i}`)].join("\n") + extra;

describe("Google Sheets links", () => {
  it("turns share, edit and published links into CSV addresses", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`)).toBe(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`);
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=12345`)).toBe(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=12345`);
    expect(sheetCsvUrl(`docs.google.com/spreadsheets/d/e/2PACX-1vAbc_def/pubhtml?gid=7`)).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-1vAbc_def/pub?output=csv&gid=7&single=true");
    expect(sheetCsvUrl("https://evil.example/spreadsheets/d/abc")).toBeNull();
    expect(sheetCsvUrl("https://docs.google.com/document/d/abc/edit")).toBeNull();
    expect(sheetCsvUrl("not a url")).toBeNull();
  });
});

describe("CSV analysis", () => {
  it("parses quoted fields with commas, quotes and line breaks", () => {
    expect(parseCsv('a,"b, c","say ""hi""","line\nbreak"\r\n1,2,3,4')).toEqual([["a", "b, c", 'say "hi"', "line\nbreak"], ["1", "2", "3", "4"]]);
  });

  it("finds error cells with their address and blanks in the required column", () => {
    const s = analyseCsv("Name,Email,Total\nAnn,ann@x.com,#REF!\nBob,,5\n,,\nCat,cat@x.com,#N/A", "email");
    expect(s.rows).toBe(3);
    expect(s.errorCells).toEqual(["C2 (#REF!)", "C5 (#N/A)"]);
    expect(s.requiredFound).toBe(true);
    expect(s.blankRequired).toBe(1);
    expect(analyseCsv("Name\nAnn", "Email").requiredFound).toBe(false);
  });
});

describe("reading the sheet", () => {
  it("follows Google redirects but explains a private sheet", async () => {
    const hops = async (url: string) =>
      url.includes("export") ? new Response(null, { status: 307, headers: { location: "https://doc-0s-sheets.googleusercontent.com/csv/abc" } }) : new Response("a,b\n1,2", { status: 200 });
    expect(await fetchSheetCsv("https://docs.google.com/spreadsheets/d/x/export?format=csv", hops)).toBe("a,b\n1,2");
    const toLogin = async () => new Response(null, { status: 302, headers: { location: "https://accounts.google.com/ServiceLogin?continue=x" } });
    await expect(fetchSheetCsv("https://docs.google.com/spreadsheets/d/x/export?format=csv", toLogin)).rejects.toThrow(/isn't shared/);
    const html = async () => new Response("<!doctype html><html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(fetchSheetCsv("https://docs.google.com/spreadsheets/d/x/export?format=csv", html)).rejects.toThrow(/isn't shared/);
    const away = async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x" } });
    await expect(fetchSheetCsv("https://docs.google.com/spreadsheets/d/x/export?format=csv", away)).rejects.toThrow(/outside Google/);
  });
});

describe("sheet checks", () => {
  it("alerts when the sheet stops changing and resolves when it updates", async () => {
    add(6);
    const t0 = new Date("2026-10-17T08:00:00Z");
    await checkSheet(watch(), csv(rows(30)), t0);
    expect(watch()).toMatchObject({ status: "ok", row_count: 30 });
    await checkSheet(watch(), csv(rows(30)), new Date(t0.getTime() + 3 * 3600000));
    expect(open()).toEqual([]);
    await checkSheet(watch(), csv(rows(30)), new Date(t0.getTime() + 7 * 3600000));
    expect(watch().status).toBe("problem");
    expect(open()).toEqual(["SHEET_STALE"]);
    await checkSheet(watch(), csv(rows(30)), new Date(t0.getTime() + 8 * 3600000)); // no duplicate alert
    expect(open()).toEqual(["SHEET_STALE"]);
    await checkSheet(watch(), csv(rows(31)), new Date(t0.getTime() + 9 * 3600000));
    expect(watch().status).toBe("ok");
    expect(open()).toEqual([]);
  });

  it("does not alert on staleness when it is turned off", async () => {
    add(0);
    const t0 = new Date("2026-10-17T08:00:00Z");
    await checkSheet(watch(), csv(rows(5)), t0);
    await checkSheet(watch(), csv(rows(5)), new Date(t0.getTime() + 30 * 86400000));
    expect(open()).toEqual([]);
  });

  it("alerts on error cells, empty required cells and vanished rows", async () => {
    add(24, "Email");
    const t0 = new Date("2026-10-17T08:00:00Z");
    await checkSheet(watch(), csv(rows(40, "\nLead X,,#DIV/0!")), t0);
    expect(open()).toEqual(["SHEET_ERRORS", "SHEET_BLANKS"]);
    expect(watch()).toMatchObject({ error_cells: 1, blank_required: 1, status: "problem" });
    const detail = get<{ detail: string }>("SELECT detail FROM incidents WHERE code = 'SHEET_ERRORS'")!.detail;
    expect(detail).toContain("C42 (#DIV/0!)");
    await checkSheet(watch(), csv(rows(3)), new Date(t0.getTime() + 900000));
    expect(open()).toEqual(["SHEET_ROWS_DROPPED"]);
    await checkSheet(watch(), csv("Name,Phone\nAnn,1"), new Date(t0.getTime() + 1800000));
    expect(open()).toContain("SHEET_COLUMN_MISSING");
  });

  it("raises 'can't read' after two failed reads and clears it when readable again", async () => {
    add(24);
    const denied = async () => new Response("no", { status: 403 });
    const t0 = new Date("2026-10-17T08:00:00Z");
    const r = await checkSheet(watch(), denied, t0);
    expect(r.error).toMatch(/isn't shared/);
    expect(open()).toEqual([]);
    await checkSheet(watch(), denied, new Date(t0.getTime() + 900000));
    expect(watch().status).toBe("error");
    expect(open()).toEqual(["SHEET_UNREADABLE"]);
    await checkSheet(watch(), csv(rows(2)), new Date(t0.getTime() + 1800000));
    expect(open()).toEqual([]);
    expect(watch()).toMatchObject({ status: "ok", fails: 0, last_error: null });
  });

  it("runs due sheets, skips demo projects and counts towards the plan", async () => {
    add(24);
    expect(usage(userId, billingState(userId).plan).monitors).toBe(1);
    const t0 = new Date("2026-10-17T08:00:00Z");
    expect(await runDueSheets(t0, csv(rows(2)))).toBe(1);
    expect(await runDueSheets(new Date(t0.getTime() + 5 * 60000), csv(rows(2)))).toBe(0); // not due yet
    expect(await runDueSheets(new Date(t0.getTime() + 15 * 60000), csv(rows(2)))).toBe(1);
    run("UPDATE projects SET is_demo = 1 WHERE id = ?", projectId);
    expect(await runDueSheets(new Date(t0.getTime() + 60 * 60000), csv(rows(2)))).toBe(0);
  });

  it("shows changes, problems and fixes in the live feed and status card", async () => {
    add(24, "Email");
    const t0 = new Date("2026-10-17T08:00:00Z");
    await checkSheet(watch(), csv(rows(10)), t0);
    await checkSheet(watch(), csv(rows(10)), new Date(t0.getTime() + 900000)); // quiet check: no event
    await checkSheet(watch(), csv(rows(13)), new Date(t0.getTime() + 1800000));
    await checkSheet(watch(), csv(rows(13, "\nLead Z,,#REF!")), new Date(t0.getTime() + 2700000));
    await checkSheet(watch(), csv(rows(15)), new Date(t0.getTime() + 3600000));
    const titles = all<{ title: string; level: string }>("SELECT title, level FROM sheet_events ORDER BY id").map((e) => `${e.level}: ${e.title}`);
    expect(titles).toEqual([
      'ok: Started watching "Leads"',
      'ok: "Leads" updated: +3 new rows',
      'warn: 1 error cell in "Leads"',
      'warn: "Email" is empty in 1 new row of "Leads"',
      'ok: "Leads" updated: +1 new row',
      'ok: "Leads": no more error cells',
      'ok: "Leads": required column is filled again',
      'ok: "Leads" updated: +1 new row',
    ]);
    const feed = liveFeed(projectId).filter((e) => e.source === "sheets");
    expect(feed).toHaveLength(8);
    const card = sourceStatuses(projectId, t0.getTime() + 3600000).find((s) => s.source === "sheets")!;
    expect(card).toMatchObject({ state: "ok", problemsLastHour: 0 });
    run("UPDATE sheet_watches SET status = 'problem'");
    expect(sourceStatuses(projectId, t0.getTime() + 3600000).find((s) => s.source === "sheets")).toMatchObject({ state: "problem", problemsLastHour: 1 });
  });
});

describe("freshness column", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  it("reads ISO, d/m/y, m/d/y, AM/PM and Unix dates", () => {
    expect(newestDate(["2026-10-17 09:30", "2026-10-16T23:00:00Z"], "UTC", now).newest).toBe(Date.parse("2026-10-17T09:30:00Z"));
    expect(newestDate(["17/10/2026 09:30:00", "3/10/2026 10:00:00"], "UTC", now).newest).toBe(Date.parse("2026-10-17T09:30:00Z"));
    expect(newestDate(["10/3/2026 9:00 PM", "10/16/2026 9:00 AM"], "UTC", now).newest).toBe(Date.parse("2026-10-16T09:00:00Z"));
    // Ambiguous: d/m outside the Americas, m/d inside.
    expect(newestDate(["1/2/2026"], "Europe/London", now).newest).toBe(Date.parse("2026-02-01T00:00:00Z"));
    expect(newestDate(["1/2/2026"], "America/New_York", now).newest).toBe(Date.parse("2026-01-02T05:00:00Z"));
    expect(newestDate([String(Math.floor(now / 1000) - 60), "hello", ""], "UTC", now)).toEqual({ newest: now - 60000, parsed: 1 });
    expect(newestDate(["2027-01-01"], "UTC", now).newest).toBeNull(); // far future ignored
  });

  it("applies the time zone, including daylight saving", () => {
    expect(zonedToUtc(2026, 10, 17, 17, 0, 0, "Asia/Karachi")).toBe(Date.parse("2026-10-17T12:00:00Z"));
    expect(zonedToUtc(2026, 7, 1, 12, 0, 0, "Europe/London")).toBe(Date.parse("2026-07-01T11:00:00Z"));
    expect(zonedToUtc(2026, 12, 1, 12, 0, 0, "Europe/London")).toBe(Date.parse("2026-12-01T12:00:00Z"));
    const s = analyseCsv("Name,Created at\nA,2026-10-17 16:00", null, { col: "created AT", tz: "Asia/Karachi", now });
    expect(s).toMatchObject({ freshFound: true, newestAt: Date.parse("2026-10-17T11:00:00Z") });
  });

  const leads = (...dates: string[]) => csv(["Name,Created at", ...dates.map((d, i) => `Lead ${i},${d}`)].join("\n"));
  const setFresh = (col: string, hours: number) => run("UPDATE sheet_watches SET fresh_col = ?, fresh_hours = ?, fresh_tz = 'UTC' WHERE project_id = ?", col, hours, projectId);

  it("alerts when no new source records arrive even though the sheet keeps changing, then resolves", async () => {
    add(6);
    setFresh("Created at", 2);
    const t = (h: number) => new Date(Date.parse("2026-10-17T08:00:00Z") + h * 3600000);
    await checkSheet(watch(), leads("2026-10-17 07:30"), t(0));
    expect(open()).toEqual([]);
    expect(watch().newest_at).toBe("2026-10-17T07:30:00.000Z");
    // The automation rewrites the sheet (a status column changes) but the newest record is still 07:30.
    const r = await checkSheet(watch(), csv("Name,Created at,Synced\nLead 0,2026-10-17 07:30,yes"), t(3));
    expect(r.problems).toContain("no new source records");
    expect(open()).toEqual(["SHEET_SOURCE_STALE"]);
    const inc = get<{ detail: string; severity: string }>("SELECT detail, severity FROM incidents WHERE code = 'SHEET_SOURCE_STALE'")!;
    expect(inc.severity).toBe("high");
    expect(inc.detail).toContain("automation is running but the source has delivered nothing new");
    expect(inc.detail).toContain("backfill");
    await checkSheet(watch(), csv("Name,Created at,Synced\nLead 0,2026-10-17 07:30,yes\nLead 1,2026-10-17 10:45,no"), t(3.5));
    expect(open()).toEqual([]);
    expect(watch().status).toBe("ok");
  });

  it("flags a missing or unreadable date column", async () => {
    add(0);
    setFresh("Created at", 24);
    await checkSheet(watch(), csv(rows(3)), new Date(now));
    expect(open()).toEqual(["SHEET_COLUMN_MISSING"]);
    run("UPDATE incidents SET resolved = 1");
    const r = await checkSheet(watch(), leads("soon", "n/a"), new Date(now));
    expect(r.problems).toContain("dates unreadable");
    expect(open()).toContain("SHEET_DATES_UNREADABLE");
  });
});

describe("sheet structure and duplicates", () => {
  it("alerts once when a column is removed or renamed", async () => {
    add(0);
    const t = new Date("2026-10-17T08:00:00Z");
    await checkSheet(watch(), csv(rows(5)), t);
    const r = await checkSheet(watch(), csv(rows(5).replace("Name,Email,Total", "Name,E-mail,Total")), t);
    expect(r.problems).toContain("columns changed");
    const inc = get<{ title: string; detail: string }>("SELECT title, detail FROM incidents WHERE code = 'SHEET_COLUMNS_CHANGED'")!;
    expect(inc.title).toBe('Column "Email" was removed from "Leads"');
    expect(inc.detail).toContain('New: "E-mail" (renamed?)');
    expect((await checkSheet(watch(), csv(rows(5).replace("Name,Email,Total", "Name,E-mail,Total")), t)).problems).toEqual([]); // new baseline
  });

  it("alerts when duplicate rows appear, not on duplicates that were always there", async () => {
    add(0);
    const t = new Date("2026-10-17T08:00:00Z");
    await checkSheet(watch(), csv(rows(10, "\nLead 0,lead0@x.com,0")), t); // one old duplicate
    expect(open()).toEqual([]);
    const r = await checkSheet(watch(), csv(rows(10, "\nLead 0,lead0@x.com,0\nLead 1,lead1@x.com,1\nLead 2,lead2@x.com,2\nLead 3,lead3@x.com,3")), t);
    expect(r.problems).toEqual(["duplicate rows"]);
    expect(open()).toEqual(["SHEET_DUPLICATES"]);
  });
});
