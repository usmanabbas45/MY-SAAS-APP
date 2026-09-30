import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { JudgeError } from "./errors";

/**
 * Google Gemini as an alternative AI judge (set GEMINI_API_KEY).
 * Default model is the Flash-Lite alias because it has the largest free-tier daily quota;
 * override with GEMINI_MODEL (e.g. a Flash or Pro model on a paid key).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function geminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

let client: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({
      apiKey: geminiKey(),
      // Free-tier keys hit per-minute limits quickly; the SDK waits and retries 408/429/5xx.
      httpOptions: { timeout: 180_000, retryOptions: { attempts: 4, initialDelay: 5, maxDelay: 60 } },
    });
  }
  return client;
}

/** Converts a zod schema to the JSON Schema subset Gemini accepts for structured output. */
export function geminiSchema(schema: z.ZodType): Record<string, unknown> {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema") continue;
      // zod adds +/- MAX_SAFE_INTEGER bounds to .int(); they carry no meaning for the model.
      if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) >= Number.MAX_SAFE_INTEGER) continue;
      out[k] = clean(v);
    }
    return out;
  };
  return clean(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export async function geminiJudge<S extends z.ZodType>(
  system: string, task: string, schema: S,
  onUsage?: (model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }) => void,
): Promise<z.infer<S>> {
  let text: string | undefined;
  try {
    const response = await gemini().models.generateContent({
      model: geminiModel(),
      contents: task,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: geminiSchema(schema),
        temperature: 0,
      },
    });
    const m = response.usageMetadata;
    if (m && onUsage) {
      const cached = m.cachedContentTokenCount ?? 0;
      onUsage(geminiModel(), { input: Math.max(0, (m.promptTokenCount ?? 0) - cached), cacheRead: cached, cacheWrite: 0, output: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0) });
    }
    text = response.text;
    if (!text) {
      const blocked = response.promptFeedback?.blockReason;
      throw new JudgeError(blocked ? `Gemini declined to grade this content (${blocked}).` : "Gemini returned an empty result.");
    }
  } catch (err) {
    if (err instanceof JudgeError) throw err;
    if (err instanceof ApiError) {
      if (err.status === 429) {
        throw new JudgeError("Gemini usage limit reached (the free tier allows a limited number of requests per minute and per day). Wait and try again, use a smaller file, or add billing to your Google AI Studio key.");
      }
      if (err.status === 400 && /api key/i.test(err.message)) throw new JudgeError("The Gemini API key is invalid.");
      if (err.status === 401 || err.status === 403) throw new JudgeError("The Gemini API key is invalid or not allowed to use this model.");
      if (err.status === 404) throw new JudgeError(`Gemini model "${geminiModel()}" was not found. Check GEMINI_MODEL.`);
      throw new JudgeError(`Gemini error (${err.status}): ${err.message}`);
    }
    throw new JudgeError(`Could not reach Gemini: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new JudgeError("Gemini returned an unreadable result.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new JudgeError("Gemini returned a result in the wrong format.");
  return parsed.data;
}
