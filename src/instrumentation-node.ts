import { alertMissingReplies } from "./lib/audit/live";
import { backupDue, runBackup } from "./lib/backup";
import { checkCronHealth, reportError } from "./lib/monitoring";
import { runDueMonitors } from "./lib/uptime";

/**
 * Every minute: missing-reply alerts (so they arrive about a minute after the project's reply-time limit
 * instead of waiting for the 15-minute scheduled job, which keeps running as a backup), uptime monitors,
 * the "background checks stopped" watchdog and the daily database backup.
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
      await step("cron-watchdog", checkCronHealth);
      if (backupDue()) await step("backup", runBackup);
    } finally {
      running = false;
    }
  }, 60_000).unref();
}
