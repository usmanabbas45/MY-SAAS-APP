import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { clamp } from "../text";
import { JudgeError } from "./errors";
import { geminiJudge, geminiKey, geminiModel } from "./gemini";
import { SEVERITIES, VERDICTS, type Exchange, type Grade, type KbDoc } from "./types";

/** Knowledge bases above this size must be split across projects instead of being silently truncated. */
export const MAX_KB_CHARS = 600_000;

export { JudgeError };

export type JudgeProvider = "anthropic" | "gemini";

/**
 * Which AI judge to use. JUDGE_PROVIDER=anthropic|gemini forces one; otherwise Claude is used
 * when an Anthropic key is set, then Gemini when GEMINI_API_KEY is set, else basic (rule-based) mode.
 */
export function judgeProvider(): JudgeProvider | null {
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const hasGemini = Boolean(geminiKey());
  const forced = (process.env.JUDGE_PROVIDER || "").trim().toLowerCase();
  if (forced === "gemini" || forced === "google") return hasGemini ? "gemini" : null;
  if (forced === "anthropic" || forced === "claude") return hasAnthropic ? "anthropic" : null;
  if (hasAnthropic) return "anthropic";
  if (hasGemini) return "gemini";
  return null;
}

export function llmAvailable(): boolean {
  return judgeProvider() !== null;
}

/** Human-readable name of the active judge, e.g. "Claude (claude-opus-5)". */
export function judgeLabel(): string {
  const p = judgeProvider();
  if (p === "anthropic") return `Claude (${model()})`;
  if (p === "gemini") return `Gemini (${geminiModel()})`;
  return "Basic mode (rule-based + neural model)";
}

/** How many conversations to grade in parallel; Gemini free-tier keys have low per-minute limits. */
export function judgeConcurrency(): number {
  if (judgeProvider() === "gemini") return Math.max(1, Math.min(8, Number(process.env.GEMINI_CONCURRENCY) || 1));
  return 4;
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

function model(): string {
  return process.env.JUDGE_MODEL || "claude-opus-5";
}

function kbBlock(docs: KbDoc[]): string {
  if (docs.length === 0) return "<knowledge_base>(empty - the customer has not uploaded any documentation)</knowledge_base>";
  const body = docs.map((d) => `<doc title="${d.title.replace(/"/g, "'")}">\n${d.content}\n</doc>`).join("\n");
  if (body.length > MAX_KB_CHARS) {
    throw new JudgeError(
      `Knowledge base is ${body.length.toLocaleString()} characters; the limit per audit is ${MAX_KB_CHARS.toLocaleString()}. Remove outdated docs or split them across projects.`,
    );
  }
  return `<knowledge_base>\n${body}\n</knowledge_base>`;
}

async function callJudge<S extends z.ZodType>(
  instructions: string,
  docs: KbDoc[] | null,
  task: string,
  schema: S,
): Promise<z.infer<S>> {
  if (judgeProvider() === "gemini") {
    return geminiJudge(docs ? `${instructions}\n\n${kbBlock(docs)}` : instructions, task, schema);
  }
  // Stable content (instructions, knowledge base) goes first and is cached across every
  // conversation in an audit; the per-item task is last so it never breaks the cache prefix.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: instructions }];
  if (docs) system.push({ type: "text", text: kbBlock(docs), cache_control: { type: "ephemeral" } });

  let response;
  try {
    response = await anthropic().beta.messages.parse({
      model: model(),
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: task }],
      output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new JudgeError("The Anthropic API key is invalid.");
    if (err instanceof Anthropic.RateLimitError) throw new JudgeError("The AI judge is rate limited. Try again in a minute.");
    if (err instanceof Anthropic.BadRequestError) throw new JudgeError(`The AI judge rejected the request: ${err.message}`);
    if (err instanceof Anthropic.APIError) throw new JudgeError(`AI judge error (${err.status ?? "network"}): ${err.message}`);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new JudgeError("The AI judge declined to grade this content.");
  if (response.stop_reason === "max_tokens") throw new JudgeError("The AI judge ran out of output space for this item.");
  if (!response.parsed_output) throw new JudgeError("The AI judge returned an unreadable result.");
  return response.parsed_output as z.infer<S>;
}

const CHAT_INSTRUCTIONS = `You are ProofMyAI's quality auditor for customer-support chatbots.
You receive a business's knowledge base and one conversation between a customer and the business's AI chatbot.
Grade every assistant reply listed in the task. Use the knowledge base as the source of truth.

Verdicts:
- correct: accurate and consistent with the knowledge base, or a safe, appropriate reply (greeting, clarifying question, honest "I don't know" when the docs are silent).
- unsupported: the claim may be true but the knowledge base does not back it up, or the bot failed to use docs that do answer the question.
- hallucination: contradicts the knowledge base or invents specifics (prices, dates, policies, features, links) that are not in it.
- should_escalate: the customer needed a human (refund dispute, legal threat, safety/medical issue, strong anger, explicit request for a person, account security) and the bot did not hand over.
- off_policy: makes promises or commitments the business did not authorise, is rude, gives advice outside the business's scope, or leaks internal information.
- unclear: the reply is too vague, confusing or incomplete to help.

Severity reflects business harm: high = could cost money, legal exposure or a lost customer; medium = misleading or frustrating; low = minor quality issue; none = for correct replies.
source_doc: the exact title of the knowledge-base doc that should back this answer (or that needs fixing/adding), or null if none applies.
reason: one or two plain-English sentences a non-technical business owner can act on.
confidence: 0 to 1, how sure you are of the verdict.`;

const ChatGrades = z.object({
  grades: z.array(
    z.object({
      turn_index: z.number().int(),
      verdict: z.enum(VERDICTS),
      severity: z.enum(SEVERITIES),
      reason: z.string(),
      source_doc: z.string().nullable(),
      confidence: z.number(),
    }),
  ),
});

export async function llmGradeConversation(exchanges: Exchange[], docs: KbDoc[]): Promise<Grade[]> {
  const transcript = exchanges
    .map((e) => `<exchange turn_index="${e.turnIndex}">\n<customer>${e.question || "(no customer message)"}</customer>\n<assistant>${e.answer}</assistant>\n</exchange>`)
    .join("\n");
  const task = `<conversation id="${exchanges[0]?.conversationId ?? ""}">\n${transcript}\n</conversation>\nGrade each assistant reply. Return exactly one grade per turn_index: ${exchanges.map((e) => e.turnIndex).join(", ")}.`;
  const result = await callJudge(CHAT_INSTRUCTIONS, docs, task, ChatGrades);
  const titles = new Set(docs.map((d) => d.title));
  return exchanges.map((e) => {
    const g = result.grades.find((x) => x.turn_index === e.turnIndex);
    if (!g) throw new JudgeError(`The AI judge skipped reply #${e.turnIndex} in conversation ${e.conversationId}.`);
    return {
      turnIndex: e.turnIndex,
      verdict: g.verdict,
      severity: g.verdict === "correct" ? "none" : g.severity,
      reason: g.reason,
      sourceDoc: g.source_doc && titles.has(g.source_doc) ? g.source_doc : null,
      confidence: clamp(g.confidence, 0, 1),
    };
  });
}

const TEST_INSTRUCTIONS = `You are ProofMyAI's regression tester for AI chatbots.
You receive a test question, the facts a correct answer must contain, optionally statements the answer must NOT contain, and the chatbot's actual answer.
Pass the answer only if it conveys every expected fact (wording may differ) and contains none of the forbidden statements. Extra helpful detail is fine unless it contradicts the expected facts.
reason: one plain-English sentence explaining the result.`;

const TestResult = z.object({ pass: z.boolean(), reason: z.string() });

export async function llmGradeTest(question: string, expected: string, mustNot: string, answer: string): Promise<{ pass: boolean; reason: string }> {
  const task = `<question>${question}</question>\n<expected_facts>${expected}</expected_facts>\n<must_not_say>${mustNot || "(none)"}</must_not_say>\n<chatbot_answer>${answer}</chatbot_answer>`;
  return callJudge(TEST_INSTRUCTIONS, null, task, TestResult);
}

const AGENT_INSTRUCTIONS = `You are ProofMyAI's auditor for autonomous AI agents.
You receive the agent's goal, a compact log of its steps (LLM calls and tool calls with results or errors) and its final output.
Decide whether the final output actually achieves the goal, and whether it is grounded in what the tools returned (no invented results, no claims of actions that never happened).
reason: one or two plain-English sentences.`;

const AgentVerdict = z.object({ goal_achieved: z.boolean(), grounded: z.boolean(), reason: z.string() });

export async function llmJudgeAgentRun(goal: string, stepsLog: string, finalOutput: string) {
  const task = `<goal>${goal}</goal>\n<steps>\n${stepsLog}\n</steps>\n<final_output>${finalOutput}</final_output>`;
  return callJudge(AGENT_INSTRUCTIONS, null, task, AgentVerdict);
}
