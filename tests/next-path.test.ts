import { describe, expect, it } from "vitest";
import { planSignupHref, safeNext } from "@/lib/next-path";

describe("after-login redirects", () => {
  it("allows invitations and plan checkouts only", () => {
    expect(safeNext("/invite/abcdefghijklmnop")).toBe("/invite/abcdefghijklmnop");
    expect(safeNext("/app/billing?plan=growth&period=year")).toBe("/app/billing?plan=growth&period=year");
    for (const bad of ["https://evil.com", "//evil.com", "/app/billing?plan=growth&period=year&x=1", "/app/billing?plan=free&period=month", "/app/admin", "", null, undefined]) {
      expect(safeNext(bad)).toBeUndefined();
    }
  });
  it("builds sign-up links that pass the check", () => {
    const href = planSignupHref("agency", "year");
    expect(safeNext(new URL(href, "https://x.test").searchParams.get("next"))).toBe("/app/billing?plan=agency&period=year");
  });
});
