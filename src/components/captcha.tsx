"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import type { CaptchaConfig } from "@/lib/captcha";

function zeroBits(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) { n += 8; continue; }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

async function solve(challenge: string, cancelled: () => boolean): Promise<string | null> {
  const [payload] = challenge.split(".");
  const { salt, bits } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { salt: string; bits: number };
  const enc = new TextEncoder();
  for (let nonce = 0; nonce < 50_000_000; nonce++) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${nonce}`)));
    if (zeroBits(hash) >= bits) return `${challenge}.${nonce}`;
    if (nonce % 2000 === 0) {
      if (cancelled()) return null;
      await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
  }
  return null;
}

/**
 * CAPTCHA field for auth forms. Built-in mode solves a proof-of-work challenge in the background
 * (no puzzle for the visitor); Turnstile mode shows Cloudflare's widget. Includes a honeypot field.
 */
export function Captcha({ config }: { config: CaptchaConfig }) {
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const challenge = config.mode === "pow" ? config.challenge : "";

  useEffect(() => {
    if (config.mode !== "pow") return;
    let stop = false;
    setToken("");
    setFailed(false);
    solve(challenge, () => stop).then((t) => { if (!stop) { if (t) setToken(t); else setFailed(true); } }).catch(() => !stop && setFailed(true));
    return () => { stop = true; };
  }, [config.mode, challenge]);

  const honeypot = (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
      <label>Leave this empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
    </div>
  );

  if (config.mode === "turnstile") {
    return (
      <>
        {honeypot}
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
        <div className="cf-turnstile captcha-box" data-sitekey={config.siteKey} data-theme="auto" style={{ marginBottom: 14 }} />
      </>
    );
  }
  return (
    <>
      {honeypot}
      <input type="hidden" name="captcha" value={token} />
      <div className={`captcha-box ${token ? "done" : ""}`} role="status" aria-live="polite">
        <span className="captcha-check" aria-hidden>{token ? "✓" : failed ? "!" : <span className="captcha-spin" />}</span>
        <span>{token ? "Verified: you're human" : failed ? "Security check failed. Reload the page." : "Checking your browser…"}</span>
        <span className="captcha-brand">🛡️ Protected</span>
      </div>
    </>
  );
}
