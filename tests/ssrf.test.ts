import { describe, expect, it } from "vitest";
import { fetch as undiciFetch } from "undici";
import { assertPublicUrl, guardedAgent, isPrivateAddress, safeFetch } from "@/lib/security";

describe("SSRF protection", () => {
  it("blocks private, loopback, metadata and reserved addresses in every notation", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "::1", "::", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::", "[::1]", "not-an-ip"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:0808:0808::"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses private URLs before and while connecting", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:3000/")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://[::ffff:7f00:1]/")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(safeFetch("http://localhost:1/")).rejects.toThrow();
  });

  it("re-checks the address when connecting (DNS rebinding)", async () => {
    // Skips the first check on purpose: the connection itself must still refuse a hostname that resolves locally.
    const err = await undiciFetch("http://localhost:3999/", { dispatcher: guardedAgent }).catch((e: Error & { cause?: Error }) => e);
    expect(String((err as Error & { cause?: Error }).cause?.message ?? err)).toMatch(/private or local/);
  });
});
