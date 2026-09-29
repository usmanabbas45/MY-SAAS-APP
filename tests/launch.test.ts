import { beforeEach, describe, expect, it } from "vitest";
import { run } from "@/lib/db";
import { averageUptime, components, overall, recordCronRun, uptimeHistory } from "@/lib/status";
import { listTestimonials, publishedTestimonials, ratingSummary, setTestimonialStatus, submitTestimonial, testimonialCounts, userHasGivenFeedback, validateTestimonial } from "@/lib/testimonials";
import { freshDb } from "./helpers";

let userId: number;
beforeEach(() => ({ userId } = freshDb()));

const good = { name: "Sara Khan", role: "Founder", company: "Shop.pk", quote: "The first audit found our bot quoting old shipping prices.", rating: 5, consent: true };

describe("testimonials", () => {
  it("validates input", () => {
    expect(validateTestimonial({ ...good, quote: "short" })).toMatch(/sentence/);
    expect(validateTestimonial({ ...good, rating: 9 })).toMatch(/rating/);
    expect(validateTestimonial({ ...good, website: "javascript:alert(1)" })).toMatch(/https/);
    expect(validateTestimonial(good)).toBeNull();
  });

  it("publishes only approved feedback with consent", async () => {
    const withConsent = await submitTestimonial(userId, good);
    const noConsent = await submitTestimonial(userId, { ...good, name: "Private", consent: false });
    expect(userHasGivenFeedback(userId)).toBe(true);
    expect(publishedTestimonials()).toHaveLength(0);
    expect(setTestimonialStatus(noConsent, "approved")).toMatch(/permission/);
    expect(setTestimonialStatus(withConsent, "approved")).toBeNull();
    expect(publishedTestimonials().map((t) => t.name)).toEqual(["Sara Khan"]);
    expect(testimonialCounts()).toEqual({ pending: 1, approved: 1, hidden: 0 });
    expect(ratingSummary()).toBeNull(); // fewer than 3 reviews: no average shown
    setTestimonialStatus(withConsent, "hidden");
    expect(publishedTestimonials()).toHaveLength(0);
    run("DELETE FROM users WHERE id = ?", userId);
    expect(listTestimonials()).toHaveLength(0);
  });
});

describe("status", () => {
  it("reports background checks from the cron heartbeat", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    const bg = () => components(now).find((c) => c.name === "Background checks")!;
    expect(bg().health).toBe("not_configured");
    recordCronRun(true, "", new Date("2026-09-29T11:50:00Z"));
    expect(bg()).toMatchObject({ health: "operational", detail: "Last run 10 min ago" });
    recordCronRun(true, "", new Date("2026-09-29T11:00:00Z"));
    expect(bg().health).toBe("degraded");
    recordCronRun(false, "boom", new Date("2026-09-29T11:55:00Z"));
    expect(bg().health).toBe("degraded");
    recordCronRun(true, "", new Date("2026-09-29T08:00:00Z"));
    expect(bg().health).toBe("outage");
    expect(overall(components(now))).toBe("outage");
    expect(components(now).find((c) => c.name === "Database")!.health).toBe("operational");
  });

  it("builds 30 days of uptime starting from the first run", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    run("INSERT INTO uptime_days (day, cron_runs, cron_failures) VALUES ('2026-09-28', 96, 0), ('2026-09-29', 44, 2)");
    const h = uptimeHistory(30, now);
    expect(h).toHaveLength(30);
    expect(h[27].pct).toBeNull();
    expect(h[29].day).toBe("2026-09-29");
    expect(h[28].pct).toBe(100);
    expect(h[29].pct).toBe(87.5); // today at noon: 42 good runs out of 48 expected so far
    expect(averageUptime([{ day: "a", pct: 100, runs: 96, failures: 0 }, { day: "b", pct: 90, runs: 86, failures: 0 }])).toBe(95);
  });
});
