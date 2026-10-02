"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const PRIVATE = ["/app", "/reset-password", "/r/", "/api/"];

/**
 * Cookie-free page view counter (first-party, no Google, no cookies, no personal data),
 * so visitors are never asked for analytics permission. Dashboard pages are never counted.
 */
export function Analytics() {
  const path = usePathname() ?? "/";
  useEffect(() => {
    // Clean up cookies left by the old Google Analytics banner.
    for (const name of document.cookie.split(";").map((c) => c.split("=")[0].trim())) {
      if (name === "pma_consent" || name === "_ga" || name.startsWith("_ga_") || name === "_gid") {
        const root = location.hostname.split(".").slice(-2).join(".");
        for (const d of ["", location.hostname, `.${root}`]) document.cookie = `${name}=; path=/; max-age=0${d ? `; domain=${d}` : ""}`;
      }
    }
  }, []);
  useEffect(() => {
    if (PRIVATE.some((p) => path.startsWith(p)) || navigator.webdriver) return;
    const utm = new URLSearchParams(location.search).get("utm_source") ?? "";
    const body = JSON.stringify({ p: path, r: document.referrer, u: utm });
    try {
      if (!navigator.sendBeacon?.("/api/pv", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/pv", { method: "POST", body, keepalive: true });
      }
    } catch { /* never break the page */ }
  }, [path]);
  return null;
}
