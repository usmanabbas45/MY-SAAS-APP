import crypto from "node:crypto";

/**
 * Checks a password against the Have I Been Pwned breach database using k-anonymity: only the first
 * 5 characters of its SHA-1 hash leave the server, never the password. Fails open (returns 0) if the
 * service can't be reached, so sign-up never breaks because of it.
 */
export async function breachCount(password: string, fetcher: typeof fetch = fetch): Promise<number> {
  if (process.env.DISABLE_BREACH_CHECK === "1") return 0;
  const hash = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const res = await fetcher(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true", "user-agent": "ProofMyAI-password-check" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return 0;
    const suffix = hash.slice(5);
    for (const line of (await res.text()).split("\n")) {
      const [s, count] = line.trim().split(":");
      if (s === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Full server-side check: strength rules plus the breach database. */
export async function strongPasswordProblem(password: string, email = ""): Promise<string | null> {
  const { checkPassword } = await import("./password");
  const c = checkPassword(password, email);
  if (!c.ok) return c.problem;
  const seen = await breachCount(password);
  if (seen > 0) return `This password has appeared in ${seen.toLocaleString("en-US")} data breaches, so attackers already know it. Please choose a different one.`;
  return null;
}
