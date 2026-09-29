import { alertMissingReplies } from "./lib/audit/live";

/**
 * Checks for unanswered customer messages every minute, so a missing-reply alert arrives about a minute
 * after the project's reply-time limit instead of waiting for the 15-minute scheduled job (which keeps
 * running as a backup).
 */
if (process.env.DISABLE_BACKGROUND_TIMERS !== "1") {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await alertMissingReplies();
    } catch (err) {
      console.error("[missing-replies] check failed:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }, 60_000).unref();
}
