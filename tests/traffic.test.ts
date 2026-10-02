import { beforeEach, describe, expect, it } from "vitest";
import { all } from "@/lib/db";
import { cleanPath, recordPageView, sourceOf, trafficSummary } from "@/lib/traffic";
import { freshDb } from "./helpers";

beforeEach(() => { freshDb(); });
const UA = "Mozilla/5.0 (Windows NT 10.0) Chrome/128.0";
const base = { referrer: "", utm: "", ip: "1.1.1.1", ua: UA, host: "proofmyai.com" };

describe("cookie-free traffic", () => {
  it("never counts private pages and strips query strings", () => {
    expect(cleanPath("/pricing?x=1")).toBe("/pricing");
    expect(cleanPath("/blog/")).toBe("/blog");
    for (const p of ["/app", "/app/p/1", "/api/pv", "/r/abc", "/reset-password"]) expect(cleanPath(p)).toBeNull();
    expect(cleanPath("/approach")).toBe("/approach");
  });

  it("names sources", () => {
    expect(sourceOf("https://www.google.co.uk/", "", "proofmyai.com")).toBe("google");
    expect(sourceOf("https://www.linkedin.com/feed", "", "proofmyai.com")).toBe("linkedin.com");
    expect(sourceOf("https://proofmyai.com/blog", "", "proofmyai.com")).toBeNull();
    expect(sourceOf("", "", "proofmyai.com")).toBe("Direct");
    expect(sourceOf("https://google.com", "LinkedIn", "proofmyai.com")).toBe("linkedin");
  });

  it("counts a visitor once per day, ignores bots and keeps only totals", () => {
    const now = new Date("2026-10-02T10:00:00Z");
    expect(recordPageView({ ...base, path: "/", referrer: "https://www.google.com/" }, now)).toBe(true);
    recordPageView({ ...base, path: "/pricing", referrer: "https://proofmyai.com/" }, now);
    recordPageView({ ...base, ip: "2.2.2.2", path: "/" }, now);
    expect(recordPageView({ ...base, ua: "Googlebot/2.1", path: "/" }, now)).toBe(false);
    const s = trafficSummary(7, now);
    expect(s).toMatchObject({ visitors: 2, views: 3 });
    expect(s.pages[0]).toEqual({ path: "/", views: 2 });
    expect(s.sources).toEqual(expect.arrayContaining([{ source: "google", visits: 1 }, { source: "Direct", visits: 1 }]));
    // Next day: yesterday's fingerprints are deleted.
    recordPageView({ ...base, path: "/" }, new Date("2026-10-03T08:00:00Z"));
    expect(all<{ day: string }>("SELECT day FROM traffic_seen").map((r) => r.day)).toEqual(["2026-10-03"]);
    expect(trafficSummary(7, new Date("2026-10-03T09:00:00Z")).visitors).toBe(3);
  });
});
