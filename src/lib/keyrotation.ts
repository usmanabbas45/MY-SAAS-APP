import { all, get, run } from "./db";
import { sendEmail } from "./email";
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

/** Counts stored credentials that neither the current nor the previous secret can open. */
export function unreadableSecrets(): { table: string; column: string; count: number }[] {
  return ENCRYPTED.map(([table, column]) => ({
    table, column,
    count: all<{ v: string }>(`SELECT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)
      .filter((r) => { try { decrypt(r.v); return false; } catch { return true; } }).length,
  })).filter((r) => r.count > 0);
}

/**
 * Recovery when the old APP_SECRET was lost (set APP_SECRET_LOST=1 for one deploy). Two-factor setups that can no
 * longer be read are reset so those people can sign in with their password and set 2FA up again, and each of
 * them is emailed. Saved connection keys are left in place: they show "please reconnect" until re-entered.
 * Opt-in on purpose, so a mistyped APP_SECRET can never reset anyone's 2FA by accident.
 */
export async function recoverFromLostSecret(): Promise<{ twoFactorReset: number; connectionsToReconnect: number }> {
  const users = all<{ id: number; email: string; s: string | null; p: string | null }>(
    "SELECT id, email, totp_secret_enc AS s, totp_pending_enc AS p FROM users WHERE totp_secret_enc IS NOT NULL OR totp_pending_enc IS NOT NULL",
  );
  let twoFactorReset = 0;
  for (const u of users) {
    const unreadable = [u.s, u.p].some((v) => { if (!v) return false; try { decrypt(v); return false; } catch { return true; } });
    if (!unreadable) continue;
    const hadTwoFactor = Boolean(get<{ enabled: number }>("SELECT totp_enabled_at IS NOT NULL AS enabled FROM users WHERE id = ?", u.id)?.enabled);
    run("UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?", u.id);
    run("DELETE FROM recovery_codes WHERE user_id = ?", u.id);
    if (!hadTwoFactor) continue;
    twoFactorReset++;
    await sendEmail(u.email, "Please turn on two-factor authentication again",
      [
        "Hello,",
        "",
        "Our hosting provider had a security incident, so we replaced all of ProofMyAI's secret keys as a precaution. Because of this, your authenticator app setup (two-factor authentication) had to be reset.",
        "",
        "Your account, projects and results are not affected. You can sign in with your email and password as usual.",
        "Please turn it back on: sign in, open Account, and choose \"Turn on two-factor authentication\". Delete the old ProofMyAI entry from your authenticator app.",
        "",
        "If any n8n, Make, CRM, Intercom, Twilio or alert connection shows \"please reconnect\", enter its key again once.",
        "",
        "Sorry for the trouble. Reply to this email if you need help.",
        "ProofMyAI",
      ].join("\n"),
    ).catch(() => false);
  }
  const connectionsToReconnect = unreadableSecrets().filter((r) => r.table !== "users").reduce((n, r) => n + r.count, 0);
  return { twoFactorReset, connectionsToReconnect };
}
