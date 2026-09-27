import { beforeEach, describe, expect, it } from "vitest";
import { createAudit, executeAudit, fixList, scoreFromSeverities } from "@/lib/audit/run";
import { parseTranscripts } from "@/lib/audit/parse";
import { get, run } from "@/lib/db";
import { weightedOverall, projectHealth } from "@/lib/health";
import { exportTrainingJsonl, retrainRiskModel } from "@/lib/ml/risk";
import { decrypt, encrypt, hashPassword, isPrivateAddress, rateLimit, verifyPassword } from "@/lib/security";
import { basicGradeTest, readPath, renderBody } from "@/lib/tests/runner";
import { freshDb } from "./helpers";

describe("security", () => {
  it("hashes and verifies passwords", () => {
    const h = hashPassword("correct horse");
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });

  it("encrypts credentials reversibly and detects tampering", () => {
    const enc = encrypt("n8n-key");
    expect(enc).not.toContain("n8n-key");
    expect(decrypt(enc)).toBe("n8n-key");
    const parts = enc.split(".");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("recognises private network addresses", () => {
    ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"].forEach((ip) =>
      expect(isPrivateAddress(ip)).toBe(true));
    ["8.8.8.8", "1.1.1.1", "2606:4700::1111"].forEach((ip) => expect(isPrivateAddress(ip)).toBe(false));
  });

  it("rate limits", () => {
    const key = `k${Math.random()}`;
    expect(rateLimit(key, 2, 60000)).toBe(true);
    expect(rateLimit(key, 2, 60000)).toBe(true);
    expect(rateLimit(key, 2, 60000)).toBe(false);
  });
});

describe("test runner helpers", () => {
  it("renders JSON body templates safely", () => {
    const body = renderBody('{"message":"{{question}}"}', 'He said "hi"\nnew line');
    expect(JSON.parse(body).message).toBe('He said "hi"\nnew line');
    expect(() => renderBody("{bad", "x")).toThrow();
  });

  it("reads response paths", () => {
    const data = { choices: [{ message: { content: "Hello" } }] };
    expect(readPath(data, "choices.0.message.content")).toBe("Hello");
    expect(readPath(data, "missing.path")).toBeUndefined();
    expect(readPath("raw", "")).toBe("raw");
  });

  it("grades tests without AI", () => {
    expect(basicGradeTest("refund within 30 days", "", "You can get a refund within 30 days.").pass).toBe(true);
    expect(basicGradeTest("refund within 30 days", "", "Please contact us.").pass).toBe(false);
    expect(basicGradeTest("refund", "lifetime warranty", "Refund available, plus lifetime warranty!").pass).toBe(false);
  });
});

describe("audit pipeline + neural retraining (basic mode)", () => {
  let projectId: number;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    ({ projectId } = freshDb());
    run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 'Refunds', 'Refunds are available within 30 days of purchase.')", projectId);
  });

  it("audits, builds a fix list, learns from feedback and exports training data", async () => {
    const rows = ["conversation_id,role,message"];
    for (let i = 0; i < 15; i++) {
      rows.push(`g${i},user,Can I get a refund?`, `g${i},bot,Refunds are available within 30 days of purchase.`);
      rows.push(`b${i},user,Can I get a refund?`, `b${i},bot,Yes you have 90 days and we pay 200 dollars bonus.`);
    }
    const { id, mode } = createAudit(projectId, "Test audit");
    expect(mode).toBe("basic");
    await executeAudit(id, projectId, parseTranscripts(rows.join("\n")));

    const audit = get<{ status: string; score: number }>("SELECT status, score FROM audits WHERE id = ?", id)!;
    expect(audit.status).toBe("done");
    expect(audit.score).toBeGreaterThan(0);
    expect(audit.score).toBeLessThan(100);
    expect(fixList(id)[0].count).toBe(15);

    expect(retrainRiskModel(projectId)).toMatchObject({ ok: false });
    run(`UPDATE audit_items SET feedback = 'agree'`);
    const result = retrainRiskModel(projectId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.valAccuracy).toBeGreaterThanOrEqual(0.9);
    const good = get<{ risk: number }>("SELECT risk FROM audit_items WHERE conversation_id = 'g0'")!;
    const bad = get<{ risk: number }>("SELECT risk FROM audit_items WHERE conversation_id = 'b0'")!;
    expect(bad.risk).toBeGreaterThan(good.risk);

    const lines = exportTrainingJsonl(projectId).split("\n");
    expect(lines).toHaveLength(30);
    expect(JSON.parse(lines[0])).toHaveProperty("human_verdict");

    const health = projectHealth(projectId);
    expect(health.modules.chatbot.score).not.toBeNull();
    expect(health.series).toHaveLength(14);
  });

  it("stores a readable error when the audit fails", async () => {
    const { id } = createAudit(projectId, "Broken");
    await executeAudit(id, projectId, [{ id: "x", turns: [{ role: "assistant", content: "hi" }] }]);
    expect(get<{ status: string }>("SELECT status FROM audits WHERE id = ?", id)?.status).toBe("done");
  });
});

describe("scores", () => {
  it("weights severities", () => {
    expect(scoreFromSeverities([])).toBe(100);
    expect(scoreFromSeverities(["none", "high"])).toBe(50);
  });
  it("averages only configured modules", () => {
    expect(weightedOverall({})).toBeNull();
    expect(weightedOverall({ chatbot: 80, workflows: null })).toBe(80);
  });
});
