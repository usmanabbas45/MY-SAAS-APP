import type { Conversation, Turn } from "../judge/types";

export const MAX_CONVERSATIONS_PER_AUDIT = 500;

/** RFC 4180-style CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const ID_COLS = ["conversation_id", "conversation", "chat_id", "session_id", "thread_id", "ticket_id", "id"];
const ROLE_COLS = ["role", "sender", "author", "from", "speaker", "type"];
const TEXT_COLS = ["message", "content", "text", "body", "utterance"];

function normaliseRole(raw: unknown): Turn["role"] | null {
  const r = String(raw ?? "").trim().toLowerCase();
  if (["user", "customer", "visitor", "client", "human", "contact", "lead", "end_user", "enduser"].includes(r)) return "user";
  if (["assistant", "bot", "ai", "agent", "chatbot", "operator", "admin", "model", "system_bot", "fin", "lyro"].includes(r)) return "assistant";
  return null;
}

function fromCsv(text: string): Conversation[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The CSV file has no data rows.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const find = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const idCol = find(ID_COLS);
  const roleCol = find(ROLE_COLS);
  const textCol = find(TEXT_COLS);
  if (idCol < 0 || roleCol < 0 || textCol < 0) {
    throw new Error(`CSV needs columns for conversation id, role and message. Found: ${header.join(", ")}. Accepted names - id: ${ID_COLS.join("/")}; role: ${ROLE_COLS.join("/")}; message: ${TEXT_COLS.join("/")}.`);
  }
  const map = new Map<string, Turn[]>();
  rows.slice(1).forEach((r, n) => {
    const role = normaliseRole(r[roleCol]);
    if (!role) throw new Error(`Row ${n + 2}: unknown role "${r[roleCol]}". Use user/customer or assistant/bot.`);
    const id = (r[idCol] ?? "").trim() || "conversation";
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push({ role, content: (r[textCol] ?? "").trim() });
  });
  return [...map].map(([id, turns]) => ({ id, turns }));
}

function turnsFrom(messages: unknown, where: string): Turn[] {
  if (!Array.isArray(messages)) throw new Error(`${where}: "messages" must be an array.`);
  return messages.flatMap((m, i) => {
    const obj = (m ?? {}) as Record<string, unknown>;
    const rawRole = obj.role ?? obj.sender ?? obj.author ?? obj.from ?? obj.type;
    if (String(rawRole).toLowerCase() === "system") return [];
    const role = normaliseRole(rawRole);
    if (!role) throw new Error(`${where}, message ${i + 1}: unknown role "${String(rawRole)}".`);
    const c = obj.content ?? obj.text ?? obj.message ?? obj.body ?? "";
    const content = Array.isArray(c)
      ? c.map((p) => (typeof p === "string" ? p : String((p as Record<string, unknown>)?.text ?? ""))).join("")
      : String(c);
    return [{ role, content: content.trim() }];
  });
}

function fromJson(text: string): Conversation[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const obj = data as Record<string, unknown>;
  const list = Array.isArray(data) ? data : Array.isArray(obj?.conversations) ? obj.conversations : null;
  if (!list) throw new Error('JSON must be an array of conversations or {"conversations": [...]}.');
  if (list.length > 0 && (list[0] as Record<string, unknown>)?.role !== undefined) {
    return [{ id: "conversation-1", turns: turnsFrom(list, "Conversation 1") }];
  }
  return list.map((c, i) => {
    const conv = (c ?? {}) as Record<string, unknown>;
    const id = String(conv.id ?? conv.conversation_id ?? conv.session_id ?? `conversation-${i + 1}`);
    return { id, turns: turnsFrom(conv.messages ?? conv.turns ?? conv.transcript, `Conversation ${id}`) };
  });
}

/** Accepts JSON (array of conversations, OpenAI-style messages) or CSV exports from Intercom, Tidio, Crisp, etc. */
export function parseTranscripts(text: string): Conversation[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The transcript file is empty.");
  const convs = (trimmed.startsWith("[") || trimmed.startsWith("{") ? fromJson(trimmed) : fromCsv(trimmed))
    .filter((c) => c.turns.some((t) => t.role === "assistant" && t.content));
  if (convs.length === 0) throw new Error("No chatbot replies found in the file.");
  if (convs.length > MAX_CONVERSATIONS_PER_AUDIT) {
    throw new Error(`This file has ${convs.length} conversations; the limit per audit is ${MAX_CONVERSATIONS_PER_AUDIT}. Split it into smaller files.`);
  }
  return convs;
}
