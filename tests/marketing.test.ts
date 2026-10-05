import { beforeEach, describe, expect, it } from "vitest";
import { attributionFrom, channelOf, encodeAttribution, parseAttribution } from "@/lib/attribution";
import { addLead, leadCounts, listLeads, recentLeadExists, setLeadStatus } from "@/lib/leads";
import { channels } from "@/lib/analytics";
import { freeCheck } from "@/lib/freecheck";
import { run } from "@/lib/db";
import { freshDb } from "./helpers";

describe("attribution", () => {
  it("reads UTM tags and referring sites, ignoring our own domain", () => {
    const a = attributionFrom(new URL("https://proofmyai.com/free-audit?utm_source=LinkedIn&utm_medium=social&utm_campaign=outreach_1"), null, "proofmyai.com");
    expect(a).toMatchObject({ source: "linkedin", medium: "social", campaign: "outreach_1", landing: "/free-audit" });
    expect(attributionFrom(new URL("https://proofmyai.com/"), "https://www.reddit.com/r/n8n/xyz", "proofmyai.com")?.referrer).toBe("reddit.com");
    expect(attributionFrom(new URL("https://proofmyai.com/pricing"), "https://proofmyai.com/", "proofmyai.com")).toBeNull();
    expect(attributionFrom(new URL("https://proofmyai.com/"), "https://x.up.railway.app/", "proofmyai.com")).toBeNull();
  });

  it("round-trips through the cookie format and strips odd characters", () => {
    const a = { source: "google", medium: "cpc", campaign: "brand", referrer: null, landing: "/" };
    expect(parseAttribution(encodeAttribution(a))).toEqual(a);
    expect(parseAttribution("s=<script>&l=/")?.source).toBe("script");
    expect(parseAttribution("")).toBeNull();
    expect(parseAttribution(encodeURIComponent(encodeAttribution(a)))).toEqual(a);
  });

  it("maps sources and referrers to friendly channels", () => {
    expect(channelOf({ source: "linkedin", medium: null, campaign: null, referrer: null, landing: null })).toBe("LinkedIn");
    expect(channelOf({ source: "facebook", medium: "paid_social", campaign: null, referrer: null, landing: null })).toBe("Facebook / Instagram (ads)");
    expect(channelOf({ source: null, medium: null, campaign: null, referrer: "google.com", landing: "/" })).toBe("Google");
    expect(channelOf({ source: null, medium: null, campaign: null, referrer: "chatgpt.com", landing: "/" })).toBe("ChatGPT");
    expect(channelOf({ source: "newsletter_x", medium: null, campaign: null, referrer: null, landing: null })).toBe("Email");
    expect(channelOf(null)).toBe("Direct / unknown");
  });
});

describe("leads and channel report", () => {
  beforeEach(() => freshDb());

  it("stores leads with their channel and tracks status", () => {
    const id = addLead({ kind: "audit_request", email: "Owner@Shop.com", website: "https://shop.com", platform: "Tidio (Lyro)" },
      { source: "linkedin", medium: null, campaign: "dm", referrer: null, landing: "/free-audit" });
    expect(recentLeadExists("owner@shop.com")).toBe(true);
    expect(listLeads()[0]).toMatchObject({ email: "owner@shop.com", channel: "LinkedIn", campaign: "dm", status: "new" });
    setLeadStatus(id, "contacted");
    expect(leadCounts()).toMatchObject({ all: 1, contacted: 1, new: 0 });
  });

  it("counts sign-ups, paying users and leads per channel", () => {
    run("UPDATE users SET signup_channel = 'Reddit', plan = 'growth', plan_status = 'active'");
    run("INSERT INTO users (email, password_hash, signup_channel) VALUES ('b@x.com', 'x', 'Reddit')");
    run("INSERT INTO users (email, password_hash) VALUES ('c@x.com', 'x')");
    addLead({ kind: "audit_request", email: "l@x.com" }, null);
    const rows = channels(null);
    expect(rows[0]).toMatchObject({ channel: "Reddit", signups: 2, paying: 1 });
    expect(rows.find((r) => r.channel === "Direct / unknown")).toMatchObject({ signups: 1, leads: 1 });
  });
});

describe("free chatbot checker", () => {
  it("flags an answer that invents numbers not in the policy (basic mode)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const r = await freeCheck("How much is shipping to Germany?", "Shipping to Germany costs $2 and takes 1 day.", "EU delivery costs €9.90 and takes 4–6 working days.");
    expect(r.mode).toBe("basic");
    expect(r.verdict).toBe("hallucination");
    expect(r.label).toBe("Made up");
  });

  it("flags a missed hand-over", async () => {
    const r = await freeCheck("I want a refund now or I'm calling my lawyer", "Thanks for reaching out! Have a great day.", "Refunds: contact support within 30 days.");
    expect(r.verdict).toBe("should_escalate");
  });
});
