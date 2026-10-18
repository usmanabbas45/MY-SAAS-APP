import { safeFetch } from "../security";

/**
 * Read-only CRM connectors. Each one lists the most recently changed contacts/leads (newest first, up to 500 per
 * check) and maps them to one shape. ProofMyAI never writes to the CRM. Personal data is reduced to hashes and
 * "is this field filled?" flags in monitor.ts before anything is stored.
 */
export type Fetcher = typeof safeFetch;
export type CrmKind = "contact" | "lead" | "deal";

export interface CrmRecord {
  id: string;
  kind: CrmKind;
  createdAt: string | null;
  updatedAt: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  owner: string | null;
  /** When someone last contacted / logged an activity (null if never; undefined if the CRM doesn't say). */
  lastActivityAt?: string | null;
}

export interface FetchResult { records: CrmRecord[]; capped: boolean }
type Creds = Record<string, string>;

export interface ProviderField { key: string; label: string; secret?: boolean; placeholder?: string; optional?: boolean }
export interface Provider {
  id: string;
  label: string;
  icon: string;
  fields: ProviderField[];
  steps: string[];
  fetch?: (c: Creds, since: string, f: Fetcher) => Promise<FetchResult>;
}

const MAX_PAGES = 5;

async function getJson(f: Fetcher, url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await f(url, { ...init, headers: { accept: "application/json", ...(init.headers as Record<string, string>) } }, 20000);
  if (res.status === 401 || res.status === 403) throw new Error(`Access denied (${res.status}). Check the token and that it has read access to contacts.`);
  if (res.status === 429) throw new Error("The CRM is rate-limiting requests (429). ProofMyAI will try again at the next check.");
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** ISO time from the many formats CRMs use ("+0000", "2026-10-18 10:00:00" in UTC, epoch ms, epoch seconds). */
export function toIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString();
  let s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) return toIso(Number(s));
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = `${s.replace(" ", "T")}Z`;
  s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim() || null);
const after = (iso: string | null, since: string) => !iso || iso >= since;

// ---------- HubSpot ----------
async function hubspot(c: Creds, since: string, f: Fetcher): Promise<FetchResult> {
  const records: CrmRecord[] = [];
  let next: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: "lastmodifieddate", operator: "GTE", value: String(Date.parse(since)) }] }],
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
      properties: ["email", "phone", "mobilephone", "firstname", "lastname", "hubspot_owner_id", "createdate", "lastmodifieddate", "notes_last_contacted"],
      limit: 100, ...(next ? { after: next } : {}),
    };
    const data = (await getJson(f, "https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST", headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" }, body: JSON.stringify(body),
    })) as { results?: { id: string; createdAt?: string; updatedAt?: string; properties?: Record<string, string | null> }[]; paging?: { next?: { after?: string } } };
    for (const r of data.results ?? []) {
      const p = r.properties ?? {};
      records.push({
        id: r.id, kind: "contact", createdAt: toIso(p.createdate ?? r.createdAt), updatedAt: toIso(p.lastmodifieddate ?? r.updatedAt),
        email: str(p.email), phone: str(p.phone ?? p.mobilephone), name: str([p.firstname, p.lastname].filter(Boolean).join(" ")),
        owner: str(p.hubspot_owner_id), lastActivityAt: toIso(p.notes_last_contacted),
      });
    }
    next = data.paging?.next?.after;
    if (!next) return { records, capped: false };
  }
  return { records, capped: true };
}

// ---------- Salesforce (Leads, client-credentials connected app) ----------
async function salesforce(c: Creds, since: string, f: Fetcher): Promise<FetchResult> {
  const base = c.instance_url.replace(/\/+$/, "");
  const tokenRes = await f(`${base}/services/oauth2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.client_id, client_secret: c.client_secret }).toString(),
  }, 20000);
  if (!tokenRes.ok) throw new Error(`Salesforce login failed (${tokenRes.status}). Check the consumer key/secret and that the Client Credentials flow is enabled.`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const soql = `SELECT Id, Email, Phone, Name, OwnerId, CreatedDate, LastModifiedDate, LastActivityDate FROM Lead WHERE LastModifiedDate >= ${since.slice(0, 19)}Z ORDER BY LastModifiedDate DESC LIMIT 500`;
  const data = (await getJson(f, `${base}/services/data/v61.0/query?q=${encodeURIComponent(soql)}`, { headers: { authorization: `Bearer ${access_token}` } })) as {
    records?: { Id: string; Email?: string; Phone?: string; Name?: string; OwnerId?: string; CreatedDate?: string; LastModifiedDate?: string; LastActivityDate?: string | null }[];
  };
  const records = (data.records ?? []).map<CrmRecord>((r) => ({
    id: r.Id, kind: "lead", createdAt: toIso(r.CreatedDate), updatedAt: toIso(r.LastModifiedDate), email: str(r.Email), phone: str(r.Phone),
    name: str(r.Name), owner: str(r.OwnerId), lastActivityAt: r.LastActivityDate ? toIso(`${r.LastActivityDate}T00:00:00Z`) : null,
  }));
  return { records, capped: records.length >= 500 };
}

// ---------- Pipedrive (persons) ----------
async function pipedrive(c: Creds, since: string, f: Fetcher): Promise<FetchResult> {
  const records: CrmRecord[] = [];
  const base = c.company ? `https://${c.company.replace(/\.pipedrive\.com.*$/, "").replace(/^https?:\/\//, "")}.pipedrive.com/api/v1` : "https://api.pipedrive.com/v1";
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = (await getJson(f, `${base}/persons?sort=${encodeURIComponent("update_time DESC")}&limit=100&start=${page * 100}`, { headers: { "x-api-token": c.token } })) as {
      data?: { id: number; name?: string; email?: { value: string }[]; phone?: { value: string }[]; owner_id?: { id: number } | number; add_time?: string; update_time?: string; last_activity_date?: string | null }[] | null;
      additional_data?: { pagination?: { more_items_in_collection?: boolean } };
    };
    let older = false;
    for (const r of data.data ?? []) {
      const updatedAt = toIso(r.update_time);
      if (!after(updatedAt, since)) { older = true; break; }
      records.push({
        id: String(r.id), kind: "contact", createdAt: toIso(r.add_time), updatedAt, email: str(r.email?.[0]?.value), phone: str(r.phone?.[0]?.value),
        name: str(r.name), owner: str(typeof r.owner_id === "object" ? r.owner_id?.id : r.owner_id), lastActivityAt: r.last_activity_date ? toIso(`${r.last_activity_date}T00:00:00Z`) : null,
      });
    }
    if (older || !data.additional_data?.pagination?.more_items_in_collection) return { records, capped: false };
  }
  return { records, capped: true };
}

// ---------- Zoho CRM (Leads, Self Client refresh token) ----------
async function zoho(c: Creds, since: string, f: Fetcher): Promise<FetchResult> {
  const dc = (c.region || "com").replace(/^\./, "");
  const tokenRes = await f(`https://accounts.zoho.${dc}/oauth/v2/token?${new URLSearchParams({ refresh_token: c.refresh_token, client_id: c.client_id, client_secret: c.client_secret, grant_type: "refresh_token" })}`, { method: "POST" }, 20000);
  const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenRes.ok || !tok.access_token) throw new Error(`Zoho login failed${tok.error ? ` (${tok.error})` : ""}. Check the client ID, secret, refresh token and region.`);
  const records: CrmRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await f(`https://www.zohoapis.${dc}/crm/v6/Leads?fields=Email,Phone,Full_Name,Owner,Created_Time,Modified_Time,Last_Activity_Time&sort_by=Modified_Time&sort_order=desc&per_page=100&page=${page}`, {
      headers: { authorization: `Zoho-oauthtoken ${tok.access_token}`, "If-Modified-Since": since },
    }, 20000);
    if (res.status === 304 || res.status === 204) return { records, capped: false };
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? `Access denied (${res.status}). The refresh token needs the ZohoCRM.modules.leads.READ scope.` : `HTTP ${res.status} from Zoho`);
    const data = (await res.json()) as { data?: { id: string; Email?: string; Phone?: string; Full_Name?: string; Owner?: { id?: string }; Created_Time?: string; Modified_Time?: string; Last_Activity_Time?: string | null }[]; info?: { more_records?: boolean } };
    for (const r of data.data ?? []) {
      records.push({
        id: r.id, kind: "lead", createdAt: toIso(r.Created_Time), updatedAt: toIso(r.Modified_Time), email: str(r.Email), phone: str(r.Phone),
        name: str(r.Full_Name), owner: str(r.Owner?.id), lastActivityAt: toIso(r.Last_Activity_Time),
      });
    }
    if (!data.info?.more_records) return { records, capped: false };
  }
  return { records, capped: true };
}

// ---------- GoHighLevel / LeadConnector (Private Integration token) ----------
async function gohighlevel(c: Creds, since: string, f: Fetcher): Promise<FetchResult> {
  const records: CrmRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = (await getJson(f, "https://services.leadconnectorhq.com/contacts/search", {
      method: "POST", headers: { authorization: `Bearer ${c.token}`, version: "2021-07-28", "content-type": "application/json" },
      body: JSON.stringify({ locationId: c.location_id, page, pageLimit: 100, sort: [{ field: "dateUpdated", direction: "desc" }] }),
    })) as { contacts?: { id: string; email?: string; phone?: string; firstNameLowerCase?: string; firstName?: string; lastName?: string; contactName?: string; assignedTo?: string; dateAdded?: string; dateUpdated?: string; lastActivity?: string | number | null }[] };
    const list = data.contacts ?? [];
    let older = false;
    for (const r of list) {
      const updatedAt = toIso(r.dateUpdated ?? r.dateAdded);
      if (!after(updatedAt, since)) { older = true; break; }
      records.push({
        id: r.id, kind: "contact", createdAt: toIso(r.dateAdded), updatedAt, email: str(r.email), phone: str(r.phone),
        name: str(r.contactName ?? [r.firstName, r.lastName].filter(Boolean).join(" ")), owner: str(r.assignedTo), lastActivityAt: toIso(r.lastActivity),
      });
    }
    if (older || list.length < 100) return { records, capped: false };
  }
  return { records, capped: true };
}

// ---------- Freshsales (Freshworks CRM) ----------
async function freshsales(c: Creds, since: string, f: Fetcher): Promise<FetchResult> {
  const domain = c.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const records: CrmRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = (await getJson(f, `https://${domain}/crm/sales/api/filtered_search/contact?page=${page}`, {
      method: "POST", headers: { authorization: `Token token=${c.token}`, "content-type": "application/json" },
      body: JSON.stringify({ filter_rule: [{ attribute: "updated_at", operator: "is_after", value: since }], sort: "updated_at", sort_type: "desc", per_page: 100 }),
    })) as { contacts?: { id: number; email?: string; mobile_number?: string; work_number?: string; display_name?: string; owner_id?: number; created_at?: string; updated_at?: string; last_contacted?: string | null }[]; meta?: { total_pages?: number } };
    for (const r of data.contacts ?? []) {
      records.push({
        id: String(r.id), kind: "contact", createdAt: toIso(r.created_at), updatedAt: toIso(r.updated_at), email: str(r.email), phone: str(r.mobile_number ?? r.work_number),
        name: str(r.display_name), owner: str(r.owner_id), lastActivityAt: toIso(r.last_contacted),
      });
    }
    if (!data.meta?.total_pages || page >= data.meta.total_pages) return { records, capped: false };
  }
  return { records, capped: true };
}

// ---------- Close ----------
async function close(c: Creds, since: string, f: Fetcher): Promise<FetchResult> {
  const records: CrmRecord[] = [];
  const auth = `Basic ${Buffer.from(`${c.token}:`).toString("base64")}`;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = (await getJson(f, `https://api.close.com/api/v1/lead/?_order_by=-date_updated&_limit=100&_skip=${page * 100}&_fields=id,display_name,contacts,date_created,date_updated`, { headers: { authorization: auth } })) as {
      data?: { id: string; display_name?: string; contacts?: { emails?: { email: string }[]; phones?: { phone: string }[] }[]; date_created?: string; date_updated?: string }[]; has_more?: boolean;
    };
    let older = false;
    for (const r of data.data ?? []) {
      const updatedAt = toIso(r.date_updated);
      if (!after(updatedAt, since)) { older = true; break; }
      const contact = r.contacts?.[0];
      records.push({ id: r.id, kind: "lead", createdAt: toIso(r.date_created), updatedAt, email: str(contact?.emails?.[0]?.email), phone: str(contact?.phones?.[0]?.phone), name: str(r.display_name), owner: null });
    }
    if (older || !data.has_more) return { records, capped: false };
  }
  return { records, capped: true };
}

// ---------- ActiveCampaign ----------
async function activecampaign(c: Creds, since: string, f: Fetcher): Promise<FetchResult> {
  const base = c.api_url.replace(/\/+$/, "").replace(/\/api\/3$/, "");
  const records: CrmRecord[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = (await getJson(f, `${base}/api/3/contacts?${new URLSearchParams({ "orders[udate]": "DESC", limit: "100", offset: String(page * 100), "filters[updated_after]": since.slice(0, 19) })}`, { headers: { "api-token": c.token } })) as {
      contacts?: { id: string; email?: string; phone?: string; firstName?: string; lastName?: string; cdate?: string; udate?: string }[]; meta?: { total?: string };
    };
    const list = data.contacts ?? [];
    for (const r of list) {
      records.push({ id: r.id, kind: "contact", createdAt: toIso(r.cdate), updatedAt: toIso(r.udate), email: str(r.email), phone: str(r.phone), name: str([r.firstName, r.lastName].filter(Boolean).join(" ")), owner: null });
    }
    if (list.length < 100) return { records, capped: false };
  }
  return { records, capped: true };
}

// ---------- Microsoft Dynamics 365 (leads, Azure app client credentials) ----------
async function dynamics(c: Creds, since: string, f: Fetcher): Promise<FetchResult> {
  const org = c.org_url.replace(/\/+$/, "");
  const tokenRes = await f(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant_id)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.client_id, client_secret: c.client_secret, scope: `${org}/.default` }).toString(),
  }, 20000);
  const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenRes.ok || !tok.access_token) throw new Error(`Microsoft login failed (${tokenRes.status}). Check the tenant ID, client ID and secret, and that the app user has read access.`);
  const filter = `modifiedon ge ${since.slice(0, 19)}Z`;
  const data = (await getJson(f, `${org}/api/data/v9.2/leads?$select=emailaddress1,telephone1,fullname,_ownerid_value,createdon,modifiedon,lastonholdtime&$filter=${encodeURIComponent(filter)}&$orderby=modifiedon desc&$top=500`, {
    headers: { authorization: `Bearer ${tok.access_token}`, "OData-Version": "4.0" },
  })) as { value?: { leadid: string; emailaddress1?: string; telephone1?: string; fullname?: string; _ownerid_value?: string; createdon?: string; modifiedon?: string }[] };
  const records = (data.value ?? []).map<CrmRecord>((r) => ({
    id: r.leadid, kind: "lead", createdAt: toIso(r.createdon), updatedAt: toIso(r.modifiedon), email: str(r.emailaddress1), phone: str(r.telephone1), name: str(r.fullname), owner: str(r._ownerid_value),
  }));
  return { records, capped: records.length >= 500 };
}

export const PROVIDERS: Provider[] = [
  { id: "hubspot", label: "HubSpot", icon: "🟧", fetch: hubspot,
    fields: [{ key: "token", label: "Private app access token", secret: true, placeholder: "pat-eu1-…" }],
    steps: ["In HubSpot, click ⚙️ Settings → Integrations → Private Apps (or Development → Legacy apps → Private) → Create a private app.", "Name it ProofMyAI. On Scopes, tick only crm.objects.contacts.read.", "Click Create app, then Show token → Copy, and paste it below."] },
  { id: "salesforce", label: "Salesforce", icon: "☁️", fetch: salesforce,
    fields: [{ key: "instance_url", label: "My Domain URL", placeholder: "https://yourcompany.my.salesforce.com" }, { key: "client_id", label: "Consumer key", secret: true }, { key: "client_secret", label: "Consumer secret", secret: true }],
    steps: ["Setup → App Manager → New Connected App (or External Client App). Enable OAuth with the scope Manage user data via APIs (api).", "Tick Enable Client Credentials Flow, save, then Manage → Edit Policies → Run As: a user with read-only access to Leads.", "Copy the Consumer Key and Secret (Manage Consumer Details) and your My Domain URL below."] },
  { id: "pipedrive", label: "Pipedrive", icon: "🟢", fetch: pipedrive,
    fields: [{ key: "token", label: "Personal API token", secret: true }, { key: "company", label: "Company domain", placeholder: "yourcompany (from yourcompany.pipedrive.com)", optional: true }],
    steps: ["In Pipedrive, click your profile picture → Personal preferences → API.", "Copy your personal API token and paste it below."] },
  { id: "zoho", label: "Zoho CRM", icon: "🟥", fetch: zoho,
    fields: [{ key: "region", label: "Data centre", placeholder: "com, eu, in, com.au, jp or ca" }, { key: "client_id", label: "Client ID", secret: true }, { key: "client_secret", label: "Client secret", secret: true }, { key: "refresh_token", label: "Refresh token", secret: true }],
    steps: ["Open api-console.zoho.com (or .eu, .in…) → Add Client → Self Client. Copy the Client ID and Secret.", "In Generate Code, enter the scope ZohoCRM.modules.leads.READ, duration 10 minutes, then Create and copy the code.", "Exchange the code for a refresh token (POST accounts.zoho.com/oauth/v2/token with grant_type=authorization_code) and paste it below, with your data centre (e.g. eu)."] },
  { id: "gohighlevel", label: "GoHighLevel", icon: "🚀", fetch: gohighlevel,
    fields: [{ key: "token", label: "Private Integration token", secret: true, placeholder: "pit-…" }, { key: "location_id", label: "Location (sub-account) ID" }],
    steps: ["In the sub-account, go to Settings → Private Integrations → Create new integration.", "Name it ProofMyAI and tick only View Contacts (contacts.readonly). Copy the token.", "Copy the Location ID from Settings → Business Profile and paste both below."] },
  { id: "freshsales", label: "Freshsales (Freshworks CRM)", icon: "🍃", fetch: freshsales,
    fields: [{ key: "domain", label: "Your domain", placeholder: "yourcompany.myfreshworks.com" }, { key: "token", label: "API key", secret: true }],
    steps: ["In Freshsales, click your profile picture → Settings → API Settings.", "Copy the API key and your account domain and paste them below."] },
  { id: "close", label: "Close", icon: "🔷", fetch: close,
    fields: [{ key: "token", label: "API key", secret: true, placeholder: "api_…" }],
    steps: ["In Close, go to Settings → Developer → API Keys → + New API Key.", "Name it ProofMyAI, copy the key and paste it below."] },
  { id: "activecampaign", label: "ActiveCampaign", icon: "🔵", fetch: activecampaign,
    fields: [{ key: "api_url", label: "API URL", placeholder: "https://youraccount.api-us1.com" }, { key: "token", label: "API key", secret: true }],
    steps: ["In ActiveCampaign, go to Settings → Developer.", "Copy the URL and the Key and paste them below."] },
  { id: "dynamics", label: "Microsoft Dynamics 365", icon: "🟦", fetch: dynamics,
    fields: [{ key: "org_url", label: "Environment URL", placeholder: "https://yourorg.crm4.dynamics.com" }, { key: "tenant_id", label: "Tenant ID" }, { key: "client_id", label: "Application (client) ID", secret: true }, { key: "client_secret", label: "Client secret", secret: true }],
    steps: ["In Azure portal → App registrations → New registration. Copy the Application (client) ID and Directory (tenant) ID, then create a client secret.", "In Power Platform admin center → your environment → Settings → Application users → + New app user, pick the app and give it a read-only role.", "Paste the environment URL, tenant ID, client ID and secret below."] },
  { id: "push", label: "Any other CRM (via n8n, Make or Zapier)", icon: "🔗",
    fields: [],
    steps: ["Use this for Monday CRM, Attio, Copper, Keap, Bitrix24, Insightly, Odoo, Airtable or any CRM n8n, Make or Zapier can read.", "Add a step that runs when a contact is created or updated and sends it to POST /api/v1/crm-records (see the example below)."] },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);
