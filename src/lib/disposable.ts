/**
 * Throwaway email providers commonly used for fake sign-ups and trial abuse. Blocked at sign-up.
 * Add more domains any time from Admin → Blocklist.
 */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "10minemail.com", "temp-mail.org", "tempmail.com", "tempmail.net", "tempmailo.com", "tempmail.dev",
  "temp-mail.io", "tempr.email", "throwawaymail.com", "trashmail.com", "trashmail.net", "trashmail.de", "yopmail.com", "yopmail.net", "yopmail.fr",
  "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mailnesia.com", "mintemail.com", "mohmal.com", "mytemp.email", "emailondeck.com",
  "fakeinbox.com", "fakemail.net", "spamgourmet.com", "spam4.me", "mailcatch.com", "tempinbox.com", "moakt.com", "mail.tm", "mail.gw",
  "burnermail.io", "33mail.com", "inboxkitten.com", "emailfake.com", "fakemailgenerator.com", "armyspy.com", "cuvox.de", "dayrep.com",
  "einrot.com", "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us", "discard.email", "discardmail.com",
  "spambox.us", "mailpoof.com", "tmail.ws", "tmpmail.org", "tmpmail.net", "tmpeml.com", "linshiyouxiang.net", "byom.de", "harakirimail.com",
  "mailforspam.com", "mailsac.com", "anonaddy.me", "trbvm.com", "getairmail.com", "incognitomail.org", "tempemail.co", "tempail.com",
  "luxusmail.org", "minuteinbox.com", "emlhub.com", "emltmp.com", "vomoto.com", "xojxe.com", "wegwerfmail.de", "wegwerfmail.net",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return false;
  const parts = domain.split(".");
  // Match the domain and its parent domains (x.mailinator.com → mailinator.com).
  return parts.slice(0, -1).some((_, i) => DISPOSABLE.has(parts.slice(i).join(".")));
}
