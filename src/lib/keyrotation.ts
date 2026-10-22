import { all, run } from "./db";
import { decrypt, encrypt, encryptedWithCurrentKey, previousAppSecret } from "./security";

/** Every column holding a credential encrypted with APP_SECRET. */
const ENCRYPTED: [table: string, column: string][] = [
  ["bot_targets", "headers_enc"],
  ["workflow_sources", "api_key_enc"],
  ["crm_sources", "creds_enc"],
  ["alert_channels", "secret_enc"],
  ["chat_sources", "secret_enc"],
  ["users", "totp_secret_enc"],
  ["users", "totp_pending_enc"],
];

/**
 * After APP_SECRET is rotated (new secret in APP_SECRET, old one in APP_SECRET_PREVIOUS), re-encrypts every
 * stored credential with the new secret so customers' connections and 2FA keep working. Safe to run on every
 * start: values already on the new secret are skipped, and values neither secret opens are left untouched.
 */
export function reencryptStoredSecrets(): { reencrypted: number; unreadable: number } {
  let reencrypted = 0, unreadable = 0;
  if (!previousAppSecret()) return { reencrypted, unreadable };
  for (const [table, column] of ENCRYPTED) {
    for (const row of all<{ id: number; v: string }>(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)) {
      if (encryptedWithCurrentKey(row.v)) continue;
      try {
        run(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, encrypt(decrypt(row.v)), row.id);
        reencrypted++;
      } catch {
        unreadable++;
      }
    }
  }
  return { reencrypted, unreadable };
}
