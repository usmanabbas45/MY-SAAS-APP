import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateContent = vi.fn();

vi.mock("@google/genai", () => {
  class ApiError extends Error {
    status: number;
    constructor(opts: { message: string; status: number }) {
      super(opts.message);
      this.status = opts.status;
    }
  }
  class GoogleGenAI {
    models = { generateContent };
  }
  return { ApiError, GoogleGenAI };
});

const { ApiError } = await import("@google/genai");
const { geminiSchema, DEFAULT_GEMINI_MODEL } = await import("@/lib/judge/gemini");
const { judgeLabel, judgeProvider, llmGradeTest } = await import("@/lib/judge/llm");
const { createAudit, executeAudit } = await import("@/lib/audit/run");
const { get, openDatabase, run } = await import("@/lib/db");
const { freshDb } = await import("./helpers");

const ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY", "JUDGE_PROVIDER", "GEMINI_MODEL"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  ENV_KEYS.forEach((k) => {
    saved[k] = process.env[k];
    delete process.env[k];
  });
  generateContent.mockReset();
});
afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
});

describe("judge provider selection", () => {
  it("uses basic mode with no keys", () => {
    expect(judgeProvider()).toBeNull();
    expect(judgeLabel()).toMatch(/Basic mode/);
  });

  it("uses Gemini when only a Gemini key is set", () => {
    process.env.GEMINI_API_KEY = "g";
    expect(judgeProvider()).toBe("gemini");
    expect(judgeLabel()).toBe(`Gemini (${DEFAULT_GEMINI_MODEL})`);
  });

  it("prefers Claude when both keys are set, unless JUDGE_PROVIDER forces Gemini", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.ANTHROPIC_API_KEY = "a";
    expect(judgeProvider()).toBe("anthropic");
    process.env.JUDGE_PROVIDER = "gemini";
    expect(judgeProvider()).toBe("gemini");
  });

  it("returns null when the forced provider has no key", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.JUDGE_PROVIDER = "gemini";
    expect(judgeProvider()).toBeNull();
  });
});

describe("Gemini schema conversion", () => {
  it("removes $schema and meaningless integer bounds but keeps enums and nullables", () => {
    const s = geminiSchema(z.object({ n: z.number().int(), v: z.enum(["a", "b"]), d: z.string().nullable() }));
    const json = JSON.stringify(s);
    expect(json).not.toContain("$schema");
    expect(json).not.toContain("9007199254740991");
    expect(json).toContain('"enum":["a","b"]');
    expect(json).toContain("null");
  });
});

describe("Gemini judge", () => {
  let projectId: number;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    ({ projectId } = freshDb());
    run("INSERT INTO kb_docs (project_id, title, content) VALUES (?, 'Shipping', 'Standard shipping takes 3 to 7 business days.')", projectId);
  });

  const conversations = [
    { id: "c1", turns: [{ role: "user" as const, content: "How long is shipping?" }, { role: "assistant" as const, content: "It takes 1 day." }] },
  ];

  it("grades an audit with Gemini, passes the knowledge base, and records the judge", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({ grades: [{ turn_index: 1, verdict: "hallucination", severity: "high", reason: "Docs say 3-7 days.", source_doc: "Shipping", confidence: 0.9 }] }),
    });
    const { id } = createAudit(projectId, "Gemini audit");
    await executeAudit(id, projectId, conversations);

    const audit = get<{ status: string; judge: string; score: number }>("SELECT status, judge, score FROM audits WHERE id = ?", id)!;
    expect(audit.status).toBe("done");
    expect(audit.judge).toBe(`Gemini (${DEFAULT_GEMINI_MODEL})`);
    const item = get<{ verdict: string; source_doc: string }>("SELECT verdict, source_doc FROM audit_items WHERE audit_id = ?", id)!;
    expect(item).toEqual({ verdict: "hallucination", source_doc: "Shipping" });

    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(call.config.systemInstruction).toContain("Standard shipping takes 3 to 7 business days.");
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.contents).toContain("It takes 1 day.");
  });

  it("stores a clear message when the free-tier limit is hit", async () => {
    generateContent.mockRejectedValue(new ApiError({ message: "RESOURCE_EXHAUSTED", status: 429 }));
    const { id } = createAudit(projectId, "Limited");
    await executeAudit(id, projectId, conversations);
    const audit = get<{ status: string; error: string }>("SELECT status, error FROM audits WHERE id = ?", id)!;
    expect(audit.status).toBe("failed");
    expect(audit.error).toMatch(/usage limit reached/);
  });

  it("reports invalid keys, unknown models, blocked and malformed replies", async () => {
    generateContent.mockRejectedValueOnce(new ApiError({ message: "API key not valid. Please pass a valid API key.", status: 400 }));
    await expect(llmGradeTest("q", "e", "", "a")).rejects.toThrow(/key is invalid/);
    generateContent.mockRejectedValueOnce(new ApiError({ message: "not found", status: 404 }));
    await expect(llmGradeTest("q", "e", "", "a")).rejects.toThrow(/was not found/);
    generateContent.mockResolvedValueOnce({ text: undefined, promptFeedback: { blockReason: "SAFETY" } });
    await expect(llmGradeTest("q", "e", "", "a")).rejects.toThrow(/declined.*SAFETY/);
    generateContent.mockResolvedValueOnce({ text: "not json" });
    await expect(llmGradeTest("q", "e", "", "a")).rejects.toThrow(/unreadable/);
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ pass: "yes" }) });
    await expect(llmGradeTest("q", "e", "", "a")).rejects.toThrow(/wrong format/);
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ pass: true, reason: "ok" }) });
    await expect(llmGradeTest("q", "e", "", "a")).resolves.toEqual({ pass: true, reason: "ok" });
  });
});

describe("database migration", () => {
  it("adds the judge column to databases created before Gemini support", () => {
    const file = `/tmp/agentproof-migrate-${Date.now()}.db`;
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE audits (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, mode TEXT, status TEXT, score REAL, error TEXT, created_at TEXT)");
    old.exec("INSERT INTO audits (project_id, name, mode, status) VALUES (1, 'old', 'basic', 'done')");
    old.close();
    const db = openDatabase(file);
    const cols = (db.prepare("PRAGMA table_info(audits)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("judge");
    expect((db.prepare("SELECT name FROM audits").get() as { name: string }).name).toBe("old");
    openDatabase(file); // running twice is safe
  });
});
