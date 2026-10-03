import { get, run } from "./db";

/** Rewards per inviter per rolling year. */
export const MAX_PER_YEAR = 12;

/**
 * Called when a subscription turns into a real payment: creates both referral rewards once (the friend's
 * and, within the yearly cap, the inviter's). Kept free of billing imports so billing.ts can call it.
 */
export function onFriendPaid(friendId: number): boolean {
  const f = get<{ referred_by: number | null }>("SELECT referred_by FROM users WHERE id = ?", friendId);
  if (!f?.referred_by) return false;
  if (get("SELECT 1 FROM referral_rewards WHERE friend_id = ?", friendId)) return false;
  const since = new Date(Date.now() - 365 * 86400000).toISOString().replace("T", " ").slice(0, 19);
  const earned = get<{ n: number }>("SELECT COUNT(*) AS n FROM referral_rewards WHERE user_id = ? AND role = 'referrer' AND created_at >= ?", f.referred_by, since)?.n ?? 0;
  run("INSERT OR IGNORE INTO referral_rewards (user_id, friend_id, role) VALUES (?, ?, 'friend')", friendId, friendId);
  if (earned < MAX_PER_YEAR) run("INSERT OR IGNORE INTO referral_rewards (user_id, friend_id, role) VALUES (?, ?, 'referrer')", f.referred_by, friendId);
  return true;
}

