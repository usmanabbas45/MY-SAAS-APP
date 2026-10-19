import { beforeEach, describe, expect, it } from "vitest";
import { POST as pushPost } from "@/app/api/v1/crm-records/route";
import { ingestCrmRecords, pollCrm, type CrmSource } from "@/lib/crm/monitor";
import { PROVIDERS, providerById, toIso, type CrmRecord } from "@/lib/crm/providers";
import { all, get, run } from "@/lib/db";
import { encrypt } from "@/lib/security";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => ({ projectId } = freshDb()));
const codes = () => all<{ code: string }>("SELECT code FROM incidents WHERE project_id = ? AND resolved = 0 ORDER BY id", projectId).map((r) => r.code);
const since = "2026-10-11T12:00:00.000Z";

/** A fake HTTP layer: the first matching URL fragment answers. */
const fake = (routes: [string, unknown, number?][]) => (async (url: string) => {
  const hit = routes.find(([frag]) => url.includes(frag));
  if (!hit) throw new Error(`unexpected ${url}`);
  return new Response(JSON.stringify(hit[1]), { status: hit[2] ?? 200 });
}) as unknown as typeof fetch;

describe("CRM connectors (read-only)", () => {
  it("parses the date formats CRMs use", () => {
    expect(toIso("2026-10-18T10:00:00.000+0000")).toBe("2026-10-18T10:00:00.000Z");
    expect(toIso("2026-10-18 10:00:00")).toBe("2026-10-18T10:00:00.000Z");
    expect(toIso(1792321200000)).toBe(new Date(1792321200000).toISOString());
    expect(toIso("1792321200")).toBe(new Date(1792321200000).toISOString());
    expect(toIso("2026-10-18T15:00:00+05:00")).toBe("2026-10-18T10:00:00.000Z");
    expect(toIso("")).toBeNull();
  });

  it("covers the popular CRMs plus a push option for any other", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["hubspot", "salesforce", "pipedrive", "zoho", "gohighlevel", "freshsales", "close", "activecampaign", "dynamics", "push"]);
  });

  it("maps each CRM's contacts and leads", async () => {
    const one = async (id: string, creds: Record<string, string>, routes: [string, unknown, number?][]) => (await providerById(id)!.fetch!(creds, since, fake(routes))).records[0];
    expect(await one("hubspot", { token: "t" }, [["api.hubapi.com", { results: [{ id: "1", properties: { email: "a@x.com", firstname: "Sara", createdate: "2026-10-18T09:00:00Z", lastmodifieddate: "2026-10-18T09:05:00Z", hubspot_owner_id: "77", notes_last_contacted: null } }] }]]))
      .toMatchObject({ id: "1", email: "a@x.com", name: "Sara", owner: "77", createdAt: "2026-10-18T09:00:00.000Z", lastActivityAt: null });
    expect(await one("salesforce", { instance_url: "https://acme.my.salesforce.com", client_id: "c", client_secret: "s" }, [["/oauth2/token", { access_token: "x" }], ["/query", { records: [{ Id: "00Q1", Email: "b@x.com", CreatedDate: "2026-10-18T09:00:00.000+0000", LastModifiedDate: "2026-10-18T09:00:00.000+0000", OwnerId: "005", LastActivityDate: null }] }]]))
      .toMatchObject({ id: "00Q1", kind: "lead", email: "b@x.com", owner: "005", createdAt: "2026-10-18T09:00:00.000Z" });
    expect(await one("pipedrive", { token: "t" }, [["/persons", { data: [{ id: 5, name: "Omar", email: [{ value: "o@x.com" }], phone: [{ value: "+44 7700 900123" }], owner_id: { id: 9 }, add_time: "2026-10-18 09:00:00", update_time: "2026-10-18 09:10:00", last_activity_date: "2026-10-18" }] }]]))
      .toMatchObject({ id: "5", phone: "+44 7700 900123", owner: "9", createdAt: "2026-10-18T09:00:00.000Z" });
    expect(await one("zoho", { region: "eu", client_id: "c", client_secret: "s", refresh_token: "r" }, [["accounts.zoho.eu", { access_token: "z" }], ["zohoapis.eu", { data: [{ id: "z1", Email: "z@x.com", Owner: { id: "u1" }, Created_Time: "2026-10-18T14:00:00+05:00", Modified_Time: "2026-10-18T14:00:00+05:00", Last_Activity_Time: null }], info: { more_records: false } }]]))
      .toMatchObject({ id: "z1", email: "z@x.com", createdAt: "2026-10-18T09:00:00.000Z" });
    expect(await one("gohighlevel", { token: "t", location_id: "L" }, [["leadconnectorhq.com", { contacts: [{ id: "g1", email: "g@x.com", contactName: "Lena", assignedTo: "u", dateAdded: "2026-10-18T09:00:00.000Z", dateUpdated: "2026-10-18T09:00:00.000Z" }] }]]))
      .toMatchObject({ id: "g1", email: "g@x.com", name: "Lena", owner: "u" });
    expect(await one("freshsales", { domain: "acme.myfreshworks.com", token: "t" }, [["filtered_search", { contacts: [{ id: 3, email: "f@x.com", mobile_number: "123456789", created_at: "2026-10-18T09:00:00Z", updated_at: "2026-10-18T09:00:00Z" }], meta: { total_pages: 1 } }]]))
      .toMatchObject({ id: "3", phone: "123456789" });
    expect(await one("close", { token: "t" }, [["api.close.com", { data: [{ id: "lead_1", display_name: "Acme", contacts: [{ emails: [{ email: "c@x.com" }] }], date_created: "2026-10-18T09:00:00Z", date_updated: "2026-10-18T09:00:00Z" }], has_more: false }]]))
      .toMatchObject({ id: "lead_1", kind: "lead", email: "c@x.com" });
    expect(await one("activecampaign", { api_url: "https://acme.api-us1.com", token: "t" }, [["/api/3/contacts", { contacts: [{ id: "8", email: "ac@x.com", cdate: "2026-10-18T09:00:00-05:00", udate: "2026-10-18T09:00:00-05:00" }] }]]))
      .toMatchObject({ id: "8", createdAt: "2026-10-18T14:00:00.000Z" });
    expect(await one("dynamics", { org_url: "https://acme.crm4.dynamics.com", tenant_id: "t", client_id: "c", client_secret: "s" }, [["login.microsoftonline.com", { access_token: "m" }], ["/api/data/", { value: [{ leadid: "d1", emailaddress1: "d@x.com", createdon: "2026-10-18T09:00:00Z", modifiedon: "2026-10-18T09:00:00Z" }] }]]))
      .toMatchObject({ id: "d1", email: "d@x.com", kind: "lead" });
  });

  it("explains a rejected token", async () => {
    await expect(providerById("hubspot")!.fetch!({ token: "bad" }, since, fake([["hubapi", {}, 401]]))).rejects.toThrow("Access denied (401)");
  });
});

describe("CRM checks", () => {
  const T0 = Date.parse("2026-10-18T12:00:00Z");
  const src = (extra: Partial<CrmSource> = {}) => {
    const id = run("INSERT INTO crm_sources (project_id, provider, name, created_at) VALUES (?, 'push', 'HubSpot', ?)", projectId, new Date(T0).toISOString()).lastInsertRowid;
    if (extra.required_fields != null || extra.followup_hours != null) run("UPDATE crm_sources SET required_fields = COALESCE(?, required_fields), followup_hours = COALESCE(?, followup_hours) WHERE id = ?", extra.required_fields ?? null, extra.followup_hours ?? null, id);
    return () => get<CrmSource>("SELECT * FROM crm_sources WHERE id = ?", id)!;
  };
  let seq = 0;
  const rec = (minsAgo: number, over: Partial<CrmRecord> = {}): CrmRecord => {
    const at = new Date(T0 - minsAgo * 60000).toISOString();
    seq++;
    return { id: `r${seq}`, kind: "lead", createdAt: at, updatedAt: at, email: `u${seq}@x.com`, phone: null, name: "N", owner: "o", ...over };
  };
  beforeEach(() => { seq = 0; });

  it("stores no names, emails or phone numbers", async () => {
    const s = src();
    await ingestCrmRecords(s(), [rec(5, { email: "secret@x.com", phone: "+44 7700 900123", name: "Sara" })], { now: new Date(T0) });
    const row = JSON.stringify(all("SELECT * FROM crm_records"));
    expect(row).not.toContain("secret@x.com");
    expect(row).not.toContain("7700");
    expect(row).not.toContain("Sara");
  });

  it("flags duplicates created after the first import", async () => {
    const s = src();
    await ingestCrmRecords(s(), [rec(60, { email: "a@x.com" }), rec(50, { email: "b@x.com" }), rec(40, { phone: "07700 900123", email: null })], { first: true, now: new Date(T0) });
    expect(codes()).toEqual([]);
    const r = await ingestCrmRecords(s(), [rec(5, { email: "A@x.com " }), rec(4, { email: "b@x.com" }), rec(3, { email: null, phone: "+44 7700 900123" }), rec(2)], { now: new Date(T0) });
    expect(r).toMatchObject({ created: 4, duplicates: 3 });
    expect(codes()).toEqual(["CRM_DUPLICATES"]);
  });

  it("flags new records missing required fields, compared with normal", async () => {
    const s = src({ required_fields: "email_or_phone,owner" });
    await ingestCrmRecords(s(), Array.from({ length: 30 }, (_, i) => rec(3 * 1440 + i * 10)), { first: true, now: new Date(T0) });
    await ingestCrmRecords(s(), Array.from({ length: 8 }, (_, i) => rec(30 + i, i < 4 ? { email: null } : {})), { now: new Date(T0) });
    expect(codes()).toEqual(["CRM_FIELDS_MISSING"]);
    expect(get<{ title: string }>("SELECT title FROM incidents WHERE code = 'CRM_FIELDS_MISSING'")!.title).toBe("4 new records in HubSpot are missing email or phone, owner");
  });

  it("flags leads nobody followed up", async () => {
    const s = src({ followup_hours: 4 });
    await ingestCrmRecords(s(), [rec(300, { lastActivityAt: null }), rec(600, { lastActivityAt: new Date(T0).toISOString() }), rec(60, { lastActivityAt: null })], { first: true, now: new Date(T0) });
    expect(codes()).toEqual(["CRM_NO_FOLLOWUP"]);
    expect(get<{ title: string }>("SELECT title FROM incidents WHERE code = 'CRM_NO_FOLLOWUP'")!.title).toContain("1 new lead");
  });

  it("flags when new leads stop arriving, using the CRM's own rhythm", async () => {
    const s = src();
    await ingestCrmRecords(s(), Array.from({ length: 20 }, (_, i) => rec(60 + i * 60)), { first: true, now: new Date(T0) }); // hourly, newest 1h ago
    expect(codes()).toEqual([]);
    await ingestCrmRecords(s(), [], { now: new Date(T0 + 3 * 3600000) }); // newest now 4h ago vs usual 1h, longest 1h
    expect(codes()).toEqual(["CRM_NO_NEW_RECORDS"]);
  });

  it("flags hundreds of records changed at once", async () => {
    const s = src();
    for (let i = 0; i < 14; i++) run("INSERT INTO crm_polls (source_id, at, updated, created) VALUES (?, ?, 5, 1)", s().id, new Date(T0 - (i + 1) * 900000).toISOString());
    await ingestCrmRecords(s(), Array.from({ length: 120 }, () => rec(10000)), { capped: false, now: new Date(T0) });
    expect(codes()).toContain("CRM_BULK_CHANGE");
  });

  it("alerts after two failed reads, then recovers", async () => {
    const id = run("INSERT INTO crm_sources (project_id, provider, name, creds_enc, created_at) VALUES (?, 'hubspot', 'HubSpot', ?, ?)", projectId, encrypt(JSON.stringify({ token: "t" })), new Date(T0).toISOString()).lastInsertRowid;
    const s = () => get<CrmSource>("SELECT * FROM crm_sources WHERE id = ?", id)!;
    expect((await pollCrm(s(), fake([["hubapi", {}, 401]]))).error).toContain("Access denied");
    expect(codes()).toEqual([]);
    await pollCrm(s(), fake([["hubapi", {}, 401]]));
    expect(codes()).toEqual(["CRM_UNREACHABLE"]);
    const ok = await pollCrm(s(), fake([["hubapi", { results: [] }]]));
    expect(ok.error).toBeNull();
    expect(codes()).toEqual([]);
  });
});

describe("POST /api/v1/crm-records (any CRM)", () => {
  it("creates the source on first use and checks the records", async () => {
    const req = (body: unknown) => new Request("http://x/api/v1/crm-records", { method: "POST", headers: { authorization: "Bearer ap_live_test" }, body: JSON.stringify(body) });
    const res = await pushPost(req({ source: "Monday CRM", records: [{ id: 1, email: "a@x.com", created_at: "2026-10-18 09:00:00" }, { id: 2, email: "a@x.com" }] }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ received: 2, new: 2, duplicates: 1 });
    expect(get<{ provider: string }>("SELECT provider FROM crm_sources WHERE name = 'Monday CRM'")!.provider).toBe("push");
    expect((await pushPost(req({ records: [] }))).status).toBe(400);
  });
});

describe("CRM in Live tracking", () => {
  it("shows new records, problems and fixes in the feed and a CRM status card", async () => {
    const { liveFeed, sourceStatuses } = await import("@/lib/live");
    const id = run("INSERT INTO crm_sources (project_id, provider, name, created_at, last_polled_at) VALUES (?, 'push', 'HubSpot', ?, ?)", projectId, new Date().toISOString(), new Date().toISOString()).lastInsertRowid;
    const s = () => get<CrmSource>("SELECT * FROM crm_sources WHERE id = ?", id)!;
    const at = new Date().toISOString();
    const r = (i: number, email: string): CrmRecord => ({ id: `x${i}`, kind: "lead", createdAt: at, updatedAt: at, email, phone: null, name: null, owner: null });
    await ingestCrmRecords(s(), [r(1, "a@x.com")], { first: true });
    await ingestCrmRecords(s(), [r(2, "a@x.com"), r(3, "a@x.com"), r(4, "a@x.com")]);
    const crm = liveFeed(projectId).filter((e) => e.source === "crm").map((e) => e.title);
    expect(crm).toEqual(expect.arrayContaining(["Connected HubSpot", "HubSpot: +3 new records", "3 duplicate records created in HubSpot"]));
    expect(sourceStatuses(projectId).find((x) => x.source === "crm")).toMatchObject({ state: "problem", problemsLastHour: 1 });
  });
});
