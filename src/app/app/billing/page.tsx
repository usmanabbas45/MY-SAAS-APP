import Link from "next/link";
import { SubmitButton, ThemeToggle } from "@/components/client";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import {
  billingConfigProblems, billingEnabled, checkPaddlePrices, billingState, checkoutSignature, paddleEnv, PAID_PLANS, PLAN_FEATURES, PLANS, priceId, usage, type Resource,
} from "@/lib/billing";
import { listProjects } from "@/lib/projects";
import { logoutAction } from "../../(auth)/actions";
import { changePlanAction, portalAction } from "./actions";
import { CheckoutButton } from "./CheckoutButton";

export const metadata = { title: "Plan & billing" };
export const dynamic = "force-dynamic";

const USAGE_LABELS: [Resource, string][] = [
  ["projects", "Projects"],
  ["conversations", "Audited conversations"],
  ["bots", "Chatbots with nightly tests"],
  ["monitors", "Workflows and AI agents"],
];

function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const enabled = billingEnabled();
  const state = billingState(user.id);
  const used = usage(user.id, state.plan);
  const projects = listProjects(user.id);
  const admin = (process.env.UNLIMITED_EMAILS ?? "").toLowerCase().split(",").map((e) => e.trim()).includes(user.email);
  let problems = billingConfigProblems();
  if (admin && enabled && problems.length === 0) problems = await checkPaddlePrices().catch(() => []);
  const subscribed = ["active", "trialing", "past_due"].includes(state.status ?? "") && state.plan.id !== "free";

  let status: { text: string; tone: string } | null = null;
  if (state.plan.id === "unlimited") status = { text: enabled ? "Owner account: no limits" : "Billing is not switched on: no limits", tone: "badge-info" };
  else if (state.cancelAt) status = { text: `Cancels on ${day(state.cancelAt)}`, tone: "badge-warn" };
  else if (state.status === "trialing") status = { text: `Free trial until ${day(state.trialEndsAt ?? state.renewsAt)}`, tone: "badge-brand" };
  else if (state.status === "past_due") status = { text: "Payment failed: update your card", tone: "badge-bad" };
  else if (state.status === "active") status = { text: `Renews on ${day(state.renewsAt)}`, tone: "badge-ok" };
  else if (state.status === "paused" || state.status === "canceled") status = { text: `Subscription ${state.status}`, tone: "badge-warn" };

  return (
    <div>
      <nav className="lp-nav">
        <Link href="/app?new=1" className="logo"><span className="logo-mark" aria-hidden>✓</span>ProofMyAI</Link>
        <div className="row">
          <ThemeToggle />
          <form action={logoutAction}><button className="btn btn-ghost btn-sm">Log out</button></form>
        </div>
      </nav>
      <main className="content" style={{ margin: "0 auto", maxWidth: 1000 }}>
        <p className="sub"><Link href={projects[0] ? `/app/p/${projects[0].id}` : "/app"}>← Back to dashboard</Link></p>
        <h1>Plan & billing</h1>
        <Flash {...flash} />

        {(admin || !enabled) && problems.length > 0 && (enabled || process.env.PADDLE_API_KEY || process.env.PADDLE_CLIENT_TOKEN) ? (
          <div className="card" style={{ borderColor: "var(--warn)" }}>
            <h2>⚠️ Paddle setup needs attention</h2>
            <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            <p className="sub" style={{ margin: 0 }}>Fix these in Paddle or in Railway → Variables (then click Deploy). Only you can see this box.</p>
          </div>
        ) : admin && enabled ? (
          <p className="alert alert-ok">✅ Paddle check passed: the API key works and all 3 prices exist as monthly subscriptions with a free trial ({paddleEnv()} mode).</p>
        ) : null}

        <div className="card">
          <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0 }}>Current plan: {state.plan.name}</h2>
            {status ? <span className={`badge ${status.tone}`}>{status.text}</span> : null}
          </div>
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            {USAGE_LABELS.map(([key, label]) => {
              const limit = state.plan[key];
              const finite = Number.isFinite(limit);
              const pct = finite ? Math.min(100, Math.round((used[key] / Math.max(1, limit)) * 100)) : 0;
              const period = key === "conversations" ? (state.plan.id === "free" ? " in total" : " this month") : "";
              return (
                <div key={key}>
                  <div className="row between"><span className="sub" style={{ margin: 0 }}>{label}{period}</span><strong>{used[key]}{finite ? ` / ${limit.toLocaleString("en-US")}` : ""}</strong></div>
                  {finite ? <div className="progress" style={{ marginTop: 6 }}><span style={{ width: `${pct}%`, background: pct >= 100 ? "var(--bad)" : undefined }} /></div> : <p className="faint" style={{ margin: "4px 0 0" }}>Unlimited</p>}
                </div>
              );
            })}
          </div>
          {state.customerId && enabled ? (
            <form action={portalAction} style={{ marginTop: 18 }}>
              <SubmitButton className="btn btn-ghost" pendingText="Opening…">Manage billing: card, invoices, cancel</SubmitButton>
            </form>
          ) : null}
        </div>

        {enabled ? (
          <>
            <h2 style={{ marginTop: 28 }}>{subscribed ? "Change plan" : "Choose a plan"}</h2>
            <p className="sub">Every plan starts with a <strong>14-day free trial</strong>. Cancel any time. <Link href="/refund">14-day money-back guarantee</Link>. Prices in USD; local tax is added at checkout where required.</p>
            <div className="grid grid-3">
              {PAID_PLANS.map((id) => {
                const plan = PLANS[id];
                const current = subscribed && state.plan.id === id;
                const featured = id === "growth";
                return (
                  <div key={id} className={`card plan ${featured ? "featured" : ""}`}>
                    <div className="row between">
                      <h3>{plan.name}</h3>
                      {current ? <span className="badge badge-ok">Your plan</span> : featured ? <span className="badge badge-brand">Most popular</span> : null}
                    </div>
                    <div className="price">${plan.price}<small>/month</small></div>
                    <ul>{PLAN_FEATURES[id as Exclude<typeof id, "free">].map((f) => <li key={f}>{f}</li>)}</ul>
                    {current ? (
                      <button className="btn btn-ghost" style={{ width: "100%" }} disabled>Current plan</button>
                    ) : subscribed ? (
                      <form action={changePlanAction}>
                        <input type="hidden" name="plan" value={id} />
                        <SubmitButton className={featured ? "btn" : "btn btn-ghost"} pendingText="Switching…">
                          {plan.price > state.plan.price ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
                        </SubmitButton>
                      </form>
                    ) : (
                      <CheckoutButton
                        priceId={priceId(id)} token={process.env.PADDLE_CLIENT_TOKEN!.trim()} env={paddleEnv()} email={user.email}
                        userId={user.id} sig={checkoutSignature(user.id)} label="Start 14-day free trial" featured={featured}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {subscribed ? <p className="faint">Upgrades take effect straight away and you pay only the difference for the rest of this month. During the free trial, switching is free.</p> : null}
            {paddleEnv() === "sandbox" ? <p className="faint">Test mode: use card 4242 4242 4242 4242, any future date, CVC 100. No real money is charged.</p> : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
