import { ImageResponse } from "next/og";

/** 1200x630 share image with the page's own title (LinkedIn, WhatsApp, X, Slack previews). */
export const OG_SIZE = { width: 1200, height: 630 };

export function ogImage({ kicker, title, footer }: { kicker: string; title: string; footer: string }) {
  const size = title.length > 70 ? 54 : title.length > 45 ? 62 : 72;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "linear-gradient(135deg, #f4f2ff 0%, #ffffff 55%, #eef6ff 100%)", color: "#0f1729", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#5b4bf5", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </div>
          <div style={{ fontSize: 34, fontWeight: 800 }}>ProofMyAI</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#5b4bf5", textTransform: "uppercase", letterSpacing: 2 }}>{kicker}</div>
          <div style={{ display: "flex", fontSize: size, fontWeight: 800, lineHeight: 1.12, letterSpacing: -1 }}>{title}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 26, color: "#5b6478" }}>
          <div style={{ display: "flex" }}>{footer}</div>
          <div style={{ display: "flex", padding: "12px 24px", borderRadius: 12, background: "#5b4bf5", color: "#fff", fontWeight: 700 }}>proofmyai.com</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
