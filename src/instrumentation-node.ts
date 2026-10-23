import { alertMissingReplies } from "./lib/audit/live";
import { backupDue, runBackup } from "./lib/backup";
import { checkCronHealth, reportError } from "./lib/monitoring";
import { runDueMonitors } from "./lib/uptime";
import { runDueSheets } from "./lib/sheets";
import { checkHeartbeats } from "./lib/heartbeats";
import { recoverFromLostSecret, reencryptStoredSecrets, unreadableSecrets } from "./lib/keyrotation";

// After an APP_SECRET rotation, move every stored credential onto the new secret before anything else runs.
try {
  const r = reencryptStoredSecrets();
  if (r.reencrypted || r.unreadable) console.log(`[security] APP_SECRET rotation: ${r.reencrypted} stored credentials re-encrypted, ${r.unreadable} unreadable`);
  if (process.env.APP_SECRET_LOST === "1") {
    void recoverFromLostSecret().then((x) => console.log(`[security] lost APP_SECRET recovery: ${x.twoFactorReset} two-factor setups reset (users emailed), ${x.connectionsToReconnect} saved connections need reconnecting`));
  } else {
    for (const u of unreadableSecrets()) console.warn(`[security] ${u.count} values in ${u.table}.${u.column} can't be read with APP_SECRET`);
  }
} catch (err) {
  console.error("[security] re-encryption after APP_SECRET rotation failed:", err);
}

/**
 * Every minute: missing-reply alerts (so they arrive about a minute after the project's reply-time limit
 * instead of waiting for the 15-minute scheduled job, which keeps running as a backup), uptime monitors,
 * Google Sheets watches, the "background checks stopped" watchdog and the daily database backup.
 */
if (process.env.DISABLE_BACKGROUND_TIMERS !== "1") {
  let running = false;
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      await reportError(`timer:${name}`, err);
    }
  };
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await step("missing-replies", alertMissingReplies);
      await step("uptime", runDueMonitors);
      await step("sheets", runDueSheets);
      await step("heartbeats", checkHeartbeats);
      await step("cron-watchdog", checkCronHealth);
      if (backupDue()) await step("backup", runBackup);
    } finally {
      running = false;
    }
  }, 60_000).unref();
}
