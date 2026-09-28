"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

// Private areas (dashboard, reset links with tokens, shared reports) are never sent to Google Analytics.
const PRIVATE = ["/app", "/reset-password", "/r/", "/api/"];

export function Analytics({ id }: { id: string }) {
  const path = usePathname() ?? "/";
  if (!/^G-[A-Z0-9]+$/.test(id) || PRIVATE.some((p) => path.startsWith(p))) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","${id}",{anonymize_ip:true});`}
      </Script>
    </>
  );
}
