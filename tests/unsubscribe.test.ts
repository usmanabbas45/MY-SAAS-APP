import { beforeEach, describe, expect, it } from "vitest";
import { get } from "@/lib/db";
import { digestEmail } from "@/lib/emails";
import { unsubHeaders, unsubscribeDigest, unsubToken, unsubUrl, validUnsub } from "@/lib/unsubscribe";
import { freshDb } from "./helpers";

let projectId: number;
beforeEach(() => ({ projectId } = freshDb()));
const digestOn = () => get<{ d: number }>("SELECT weekly_digest AS d FROM projects WHERE id = ?", projectId)!.d;

describe("weekly summary unsubscribe", () => {
  it("only the project's own token turns the summary off", () => {
    expect(validUnsub(projectId, "x".repeat(32))).toBe(false);
    expect(validUnsub(projectId + 1, unsubToken(projectId))).toBe(false);
    expect(unsubscribeDigest(projectId, "nope")).toBe(false);
    expect(digestOn()).toBe(1);
    expect(unsubscribeDigest(projectId, unsubToken(projectId))).toBe(true);
    expect(digestOn()).toBe(0);
  });

  it("the digest email carries one-click unsubscribe headers and link", () => {
    const url = unsubUrl(projectId);
    const mail = digestEmail({ projectId, projectName: "Shop", score: 90, modules: [], answers: 10, bad: 1, newIncidents: 0, openIncidents: 0, top: [] }, { url, headers: unsubHeaders(projectId) });
    expect(mail.headers).toEqual({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(mail.text).toContain(url);
    expect(mail.html).toContain("Unsubscribe");
  });
});
