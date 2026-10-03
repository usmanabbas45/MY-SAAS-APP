import { get } from "@/lib/db";
import { esc } from "@/lib/emails";
import { unsubscribeDigest, unsubscribeWelcome, validUnsub, validWelcomeUnsub } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ProofMyAI</title>
<style>body{margin:0;background:#f1f3f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f1729}main{max-width:460px;margin:12vh auto;padding:32px 28px;background:#fff;border:1px solid #e3e6ef;border-radius:14px;text-align:center}h1{font-size:22px;margin:0 0 12px}p{color:#5b6478;line-height:1.6}button{background:#5b4bf5;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer}a{color:#5b4bf5}@media(max-width:520px){main{margin:16px}}</style></head>
<body><main>${body}</main></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
);

const params = (req: Request) => { const u = new URL(req.url); return { p: Number(u.searchParams.get("p")), t: u.searchParams.get("t") ?? "", welcome: u.searchParams.get("k") === "welcome" }; };
const bad = () => page("Link not valid", `<h1>This link isn't valid</h1><p>Turn the weekly summary off in your dashboard instead: <strong>Settings → Privacy &amp; reports</strong>.</p><p><a href="/app">Open dashboard</a></p>`, 400);

/** Asks first: email scanners open links, and a GET must never unsubscribe on its own. */
export async function GET(req: Request) {
  const { p, t, welcome } = params(req);
  if (welcome) {
    if (!validWelcomeUnsub(p, t)) return bad();
    return page("Unsubscribe", `<h1>Stop the getting-started emails?</h1><p>You won't get any more tips about setting up ProofMyAI. Alerts and account emails are not affected.</p><form method="post"><button>Unsubscribe</button></form>`);
  }
  if (!validUnsub(p, t)) return bad();
  const name = get<{ name: string }>("SELECT name FROM projects WHERE id = ?", p)?.name ?? "this project";
  return page("Unsubscribe", `<h1>Stop the weekly summary?</h1><p>You'll no longer get the weekly AI quality email for <strong>${esc(name)}</strong>. Problem alerts are not affected.</p><form method="post"><button>Unsubscribe</button></form>`);
}

/** The button above, and Gmail/Yahoo one-click unsubscribe (RFC 8058). */
export async function POST(req: Request) {
  const { p, t, welcome } = params(req);
  if (welcome) {
    if (!unsubscribeWelcome(p, t)) return bad();
    return page("Unsubscribed", `<h1>✓ You're unsubscribed</h1><p>No more getting-started emails. Questions? Just reply to any email from us.</p><p><a href="/">proofmyai.com</a></p>`);
  }
  if (!unsubscribeDigest(p, t)) return bad();
  return page("Unsubscribed", `<h1>✓ You're unsubscribed</h1><p>The weekly summary is off. You can turn it back on any time in <strong>Settings → Privacy &amp; reports</strong>.</p><p><a href="/">proofmyai.com</a></p>`);
}
