"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Private areas (dashboard, reset links with tokens, shared reports) are never sent to Google Analytics.
const PRIVATE = ["/app", "/reset-password", "/r/", "/api/"];
export const CONSENT_COOKIE = "pma_consent";
const OPEN_EVENT = "pma-consent-open";

type Consent = "granted" | "denied" | null;

function readConsent(): Consent {
  const m = document.cookie.match(/(?:^|;\s*)pma_consent=(granted|denied)/);
  return (m?.[1] as Consent) ?? null;
}

function saveConsent(value: "granted" | "denied") {
  document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  if (value === "denied") {
    // Remove any Google Analytics cookies set before consent was withdrawn.
    const host = location.hostname;
    const domains = ["", host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
    for (const c of document.cookie.split(";").map((x) => x.split("=")[0].trim()).filter((n) => n === "_ga" || n.startsWith("_ga_") || n === "_gid")) {
      for (const d of domains) document.cookie = `${c}=; path=/; max-age=0${d ? `; domain=${d}` : ""}`;
    }
  }
}

/** Google Analytics, loaded only after the visitor accepts analytics cookies (GDPR / ePrivacy). */
export function Analytics({ id }: { id: string }) {
  const path = usePathname() ?? "/";
  const [consent, setConsent] = useState<Consent | "loading">("loading");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const c = readConsent();
    setConsent(c);
    setOpen(c === null);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);

  if (!/^G-[A-Z0-9]+$/.test(id)) return null;
  const isPrivate = PRIVATE.some((p) => path.startsWith(p));
  const choose = (value: "granted" | "denied") => {
    saveConsent(value);
    setOpen(false);
    // Reload after withdrawing so the already-loaded tag stops running.
    if (value === "denied" && consent === "granted") location.reload();
    else setConsent(value);
  };

  return (
    <>
      {consent === "granted" && !isPrivate ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","${id}",{anonymize_ip:true});`}
          </Script>
        </>
      ) : null}
      {open && (!isPrivate || consent !== null) ? (
        <div className="cookie-banner" role="dialog" aria-live="polite" aria-label="Cookie choices">
          <p>
            We use Google Analytics cookies to see which pages are useful. They are only set if you accept.{" "}
            <a href="/privacy#cookies">Privacy Policy</a>
          </p>
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => choose("denied")}>Reject</button>
            <button type="button" className="btn btn-sm" onClick={() => choose("granted")}>Accept</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Footer link that reopens the cookie banner. */
export function CookieSettingsLink() {
  return <button type="button" className="linklike" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>Cookie settings</button>;
}
