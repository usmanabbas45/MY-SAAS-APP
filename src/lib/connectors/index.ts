import { all } from "../db";
import { pollIntercomSource } from "./intercom";
import { pollChatSource, type ChatSource } from "./twilio";

/** Polls one connected chat platform with the right connector. */
export function pollAnySource(src: ChatSource): Promise<{ replies: number; waiting: number; error: string | null }> {
  return src.platform === "intercom" ? pollIntercomSource(src) : pollChatSource(src);
}

export async function pollAllChatSources(): Promise<number> {
  const sources = all<ChatSource>("SELECT * FROM chat_sources");
  for (const s of sources) await pollAnySource(s);
  return sources.length;
}
