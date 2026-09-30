import { SITE_URL } from "./seo";
import { derivedKey } from "./security";

/**
 * IndexNow: tells Bing, Yandex, Seznam and Naver (and through Bing, ChatGPT search and Copilot) that pages
 * changed, so they are re-crawled within hours instead of weeks. The key is derived from APP_SECRET.
 */
export const indexNowKey = () => derivedKey("indexnow");
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";

export async function submitToIndexNow(urls: string[], fetcher: typeof fetch = fetch): Promise<{ ok: boolean; status: number; count: number }> {
  const host = new URL(SITE_URL).host;
  const urlList = [...new Set(urls)].filter((u) => new URL(u).host === host).slice(0, 10000);
  const res = await fetcher("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key: indexNowKey(), keyLocation: `${SITE_URL}${INDEXNOW_KEY_PATH}`, urlList }),
    signal: AbortSignal.timeout(15000),
  });
  // 200 = accepted, 202 = accepted and key validation pending.
  return { ok: res.status === 200 || res.status === 202, status: res.status, count: urlList.length };
}
