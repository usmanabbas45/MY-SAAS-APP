import { afterEach, describe, expect, it } from "vitest";
import { get, run } from "@/lib/db";
import { reencryptStoredSecrets } from "@/lib/keyrotation";
import { decrypt, encrypt } from "@/lib/security";
import { unsubToken, validUnsub } from "@/lib/unsubscribe";
import { freshDb } from "./helpers";

const OLD = "old-secret-old-secret-old-secret", NEW = "new-secret-new-secret-new-secret";
const saved = { s: process.env.APP_SECRET, p: process.env.APP_SECRET_PREVIOUS };
afterEach(() => { process.env.APP_SECRET = saved.s; if (saved.p === undefined) delete process.env.APP_SECRET_PREVIOUS; else process.env.APP_SECRET_PREVIOUS = saved.p; });

describe("rotating APP_SECRET after a leak", () => {
  it("re-encrypts stored credentials with the new secret and keeps them readable", () => {
    const { projectId } = freshDb();
    process.env.APP_SECRET = OLD;
    const enc = encrypt("n8n-api-key-123");
    const id = run("INSERT INTO workflow_sources (project_id, platform, name, base_url, api_key_enc) VALUES (?, 'n8n', 'n8n', 'https://n8n.example.com', ?)", projectId, enc).lastInsertRowid;
    const oldUnsub = unsubToken(projectId);

    process.env.APP_SECRET = NEW;
    delete process.env.APP_SECRET_PREVIOUS;
    expect(() => decrypt(enc)).toThrow(); // a plain swap would break every connection
    expect(reencryptStoredSecrets()).toEqual({ reencrypted: 0, unreadable: 0 });

    process.env.APP_SECRET_PREVIOUS = OLD;
    expect(validUnsub(projectId, oldUnsub)).toBe(true); // links in emails sent before the rotation still work
    expect(reencryptStoredSecrets()).toEqual({ reencrypted: 1, unreadable: 0 });
    expect(reencryptStoredSecrets()).toEqual({ reencrypted: 0, unreadable: 0 }); // idempotent

    delete process.env.APP_SECRET_PREVIOUS; // old secret fully retired
    const stored = get<{ v: string }>("SELECT api_key_enc AS v FROM workflow_sources WHERE id = ?", id)!.v;
    expect(decrypt(stored)).toBe("n8n-api-key-123");
    expect(validUnsub(projectId, oldUnsub)).toBe(false);
  });
});
