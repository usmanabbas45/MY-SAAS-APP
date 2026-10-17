import { beforeEach, describe, expect, it } from "vitest";
import { usage, billingState } from "@/lib/billing";
import { all, get, run } from "@/lib/db";
import { analyseCsv, checkSheet, fetchSheetCsv, parseCsv, runDueSheets, sheetCsvUrl, type SheetWatch } from "@/lib/sheets";
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
});
