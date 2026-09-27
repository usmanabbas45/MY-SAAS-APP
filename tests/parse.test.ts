import { describe, expect, it } from "vitest";
import { parseCsv, parseTranscripts } from "@/lib/audit/parse";

describe("CSV parser", () => {
  it("handles quotes, commas and newlines inside fields", () => {
    const rows = parseCsv('a,b\n"hello, world","line1\nline2"\n"say ""hi""",x\r\n');
    expect(rows).toEqual([["a", "b"], ["hello, world", "line1\nline2"], ['say "hi"', "x"]]);
  });
});

describe("transcript import", () => {
  it("reads CSV exports with flexible column names", () => {
    const csv = "conversation_id,sender,text\n1,customer,Where is my order?\n1,bot,It ships in 3 days.\n2,visitor,Hi\n2,ai,Hello!";
    const convs = parseTranscripts(csv);
    expect(convs).toHaveLength(2);
    expect(convs[0].turns[1]).toEqual({ role: "assistant", content: "It ships in 3 days." });
  });

  it("reads JSON conversations and skips system messages", () => {
    const json = JSON.stringify([
      { id: "x", messages: [{ role: "system", content: "be nice" }, { role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }] },
    ]);
    const convs = parseTranscripts(json);
    expect(convs[0].id).toBe("x");
    expect(convs[0].turns).toHaveLength(2);
  });

  it("reads a single OpenAI-style message array and content-part arrays", () => {
    const json = JSON.stringify([
      { role: "user", content: [{ type: "text", text: "Price?" }] },
      { role: "assistant", content: "10 dollars" },
    ]);
    expect(parseTranscripts(json)[0].turns[0].content).toBe("Price?");
  });

  it("gives clear errors for bad input", () => {
    expect(() => parseTranscripts("")).toThrow(/empty/);
    expect(() => parseTranscripts("{bad json")).toThrow(/valid JSON/);
    expect(() => parseTranscripts("foo,bar\n1,2")).toThrow(/columns/);
    expect(() => parseTranscripts("id,role,message\n1,robot,hi")).toThrow(/unknown role/);
    expect(() => parseTranscripts("id,role,message\n1,user,hi")).toThrow(/No chatbot replies/);
  });
});
