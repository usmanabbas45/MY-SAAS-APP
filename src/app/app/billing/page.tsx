import { foundingStatus } from "@/lib/founding";
import Link from "next/link";
import { SubmitButton, ThemeToggle } from "@/components/client";
import { Flash } from "@/components/ui";
import { isAdmin } from "@/lib/admin";
import { requireUser } from "@/lib/auth";
import {
  billingConfigProblems, billingEnabled, checkPaddlePrices, billingState, checkoutSignature, paddleEnv, PAID_PLANS, PLAN_FEATURES, PLANS, priceId, usage, yearlyAvailable, yearlyMonthly, yearlyPrice, YEARLY_MONTHS, type Interval, type Resource,
} from "@/lib/billing";
import { listProjects } from "@/lib/projects";
import { logoutAction } from "../../(auth)/actions";
import { autoRenewAction, changePlanAction, portalAction } from "./actions";
import { CheckoutButton } from "./CheckoutButton";

export const metadata = { title: "Plan & billing" };
export const dynamic = "force-dynamic";

const USAGE_LABELS: [Resource, string][] = [
  ["projects", "Projects"],
  ["conversations", "Audited conversations"],
  ["bots", "Chatbots with nightly tests"],
  ["monitors", "Workflows and AI agents"],
  ["uptime", "Uptime monitors"],
  ["seats", "Team members"],
];

function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; period?: string; plan?: string }> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const enabled = billingEnabled();
  const state = billingState(user.id);
  const used = usage(user.id, state.plan);
  const projects = listProjects(user.id);
  const admin = isAdmin(user.email);
  let problems = billingConfigProblems();
  if (admin && enabled && problems.length === 0) problems = await checkPaddlePrices().catch(() => []);
  const autoRenew = !state.cancelAt;
  const founding = foundingStatus(user.id);
  const subscribed = ["active", "trialing", "past_due"].includes(state.status ?? "") && state.plan.id !== "free";
  const yearly = yearlyAvailable();
  const period: Interval = !yearly ? "month" : flash.period === "year" || flash.period === "month" ? flash.period : subscribed ? state.interval : "month";
  const { period: _p, plan: chosen, ...messages } = flash;

  let status: { text: string; tone: string } | null = null;
  if (state.plan.id === "unlimited") status = { text: enabled ? "Owner account: no limits" : "Billing is not switched on: no limits", tone: "badge-info" };
  else if (state.cancelAt) status = { text: `Cancels on ${day(state.cancelAt)}`, tone: "badge-warn" };
  else if (state.status === "trialing") status = { text: `Free trial until ${day(state.trialEndsAt ?? state.renewsAt)}`, tone: "badge-brand" };
  else if (state.status === "past_due") status = { text: "Payment failed: update your card", tone: "badge-bad" };
  else if (state.status === "active") status = { text: `${state.interval === "year" ? "Yearly plan · renews" : "Renews"} on ${day(state.renewsAt)}`, tone: "badge-ok" };
  else if (state.status === "comped" && founding.active && founding.endsAt) status = { text: `🎉 Founding customer: free until ${day(founding.endsAt)}`, tone: "badge-ok" };
  else if (state.status === "comped") status = { text: "Free plan upgrade from ProofMyAI", tone: "badge-ok" };
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
        <Flash {...messages} />

        {(admin || !enabled) && problems.length > 0 && (enabled || process.env.PADDLE_API_KEY || process.env.PADDLE_CLIENT_TOKEN) ? (
          <div className="card" style={{ borderColor: "var(--warn)" }}>
            <h2>⚠️ Paddle setup needs attention</h2>
            <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            <p className="sub" style={{ margin: 0 }}>Fix these in Paddle or in Railway → Variables (then click Deploy). Only you can see this box.</p>
          </div>
        ) : admin && enabled ? (
          <p className="alert alert-ok">✅ Paddle check passed: the API key works and your prices exist with a free trial ({paddleEnv()} mode).{yearly ? " Yearly plans are on." : " Yearly plans are off until you add the PADDLE_PRICE_…_YEARLY variables."}</p>
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
              const period = key === "conversations" ? " this month" : "";
              return (
                <div key={key}>
                  <div className="row between"><span className="sub" style={{ margin: 0 }}>{label}{period}</span><strong>{used[key]}{finite ? ` / ${limit.toLocaleString("en-US")}` : ""}</strong></div>
                  {finite ? <div className="progress" style={{ marginTop: 6 }}><span style={{ width: `${pct}%`, background: pct >= 100 ? "var(--bad)" : undefined }} /></div> : <p className="faint" style={{ margin: "4px 0 0" }}>Unlimited</p>}
                </div>
              );
            })}
          </div>
          {enabled && state.subscriptionId && ["active", "trialing", "past_due"].includes(state.status ?? "") ? (
            <div className="autorenew" style={{ marginTop: 18 }}>
              <form action={autoRenewAction}>
                <input type="hidden" name="on" value={autoRenew ? "0" : "1"} />
                <SubmitButton
                  className={`switch ${autoRenew ? "on" : ""}`}
                  pendingText={autoRenew ? "Turning off…" : "Turning on…"}
                  confirm={autoRenew ? `Turn off auto-renew? You keep ${state.plan.name} until ${day(state.renewsAt) || "the end of this period"}, then move to the Free plan. You won't be charged again.` : undefined}
                >
                  <span className="switch-knob" aria-hidden /> Auto-renew {autoRenew ? "ON" : "OFF"}
                </SubmitButton>
              </form>
              <p className="sub" style={{ margin: 0 }}>
                {autoRenew
                  ? state.status === "trialing"
                    ? `Your free trial becomes a paid plan on ${day(state.trialEndsAt ?? state.renewsAt)}. Turn auto-renew off before then and you won't be charged.`
                    : `Your plan renews automatically on ${day(state.renewsAt)}.`
                  : `Your plan ends on ${day(state.cancelAt)} and you won't be charged again. Turn auto-renew back on any time before then to keep it.`}
              </p>
            </div>
          ) : null}
          {state.customerId && enabled ? (
            <form action={portalAction} style={{ marginTop: 18 }}>
              <SubmitButton className="btn btn-ghost" pendingText="Opening…">Manage billing: card, invoices, cancel</SubmitButton>
            </form>
          ) : null}
        </div>

        {enabled ? (
          <>
            <h2 style={{ marginTop: 28 }}>{subscribed ? "Change plan" : "Choose a plan"}</h2>
            {yearly ? (
              <div className="period-toggle" role="tablist" aria-label="Billing period">
                <Link href="/app/billing?period=month" role="tab" aria-selected={period === "month"} className={period === "month" ? "active" : ""}>Monthly</Link>
                <Link href="/app/billing?period=year" role="tab" aria-selected={period === "year"} className={period === "year" ? "active" : ""}>Yearly <span className="badge badge-ok">2 months free</span></Link>
              </div>
            ) : null}
            <p className="sub">Every plan starts with a <strong>14-day free trial</strong>. Cancel any time. <Link href="/refund">14-day money-back guarantee</Link>. Prices in USD; local tax is added at checkout where required.</p>
            <div className="grid grid-4">
              {PAID_PLANS.map((id) => {
                const plan = PLANS[id];
                const yearlyHere = period === "year" && Boolean(priceId(id, "year"));
                const interval: Interval = yearlyHere ? "year" : "month";
                const current = subscribed && state.plan.id === id && state.interval === interval;
                const samePlan = subscribed && state.plan.id === id;
                const featured = chosen && PAID_PLANS.includes(chosen as never) ? chosen === id : id === "growth";
                if (!priceId(id) && !current) {
                  // Optional plan without a Paddle price yet: sold through a conversation.
                  return (
                    <div key={id} className="card plan">
                      <h3>{plan.name}</h3>
                      <div className="price">${plan.price}<small>/month</small></div>
                      <ul>{PLAN_FEATURES[id as Exclude<typeof id, "free">].map((f) => <li key={f}>{f}</li>)}</ul>
                      <Link className="btn btn-ghost" style={{ width: "100%" }} href="/contact">Talk to us</Link>
                    </div>
                  );
                }
                return (
                  <div key={id} id={`plan-${id}`} className={`card plan ${featured ? "featured" : ""}`}>
                    <div className="row between">
                      <h3>{plan.name}</h3>
                      {current ? <span className="badge badge-ok">Your plan</span> : chosen === id ? <span className="badge badge-brand">Your choice</span> : featured ? <span className="badge badge-brand">Most popular</span> : null}
                    </div>
                    {yearlyHere ? (
                      <>
                        <div className="price">${yearlyPrice(id).toLocaleString("en-US")}<small>/year</small></div>
                        <p className="price-note">Works out at ${yearlyMonthly(id)}/month · <strong>save ${plan.price * 12 - yearlyPrice(id)}</strong> vs monthly</p>
                      </>
                    ) : (
                      <>
                        <div className="price">${plan.price}<small>/month</small></div>
                        <p className="price-note">{period === "year" ? "Monthly billing only" : "Billed monthly"}</p>
                      </>
                    )}
                    <ul>{PLAN_FEATURES[id as Exclude<typeof id, "free">].map((f) => <li key={f}>{f}</li>)}</ul>
                    {current ? (
                      <button className="btn btn-ghost" style={{ width: "100%" }} disabled>Current plan</button>
                    ) : subscribed ? (
                      <form action={changePlanAction}>
                        <input type="hidden" name="plan" value={id} />
                        <input type="hidden" name="interval" value={interval} />
                        <SubmitButton className={featured ? "btn" : "btn btn-ghost"} pendingText="Switching…" confirm={interval === "year" ? (state.status === "trialing"
                          ? `Switch to ${plan.name} yearly? Nothing is charged during your free trial. When it ends you pay $${yearlyPrice(id).toLocaleString("en-US")} for the year.`
                          : `Switch to ${plan.name} yearly for $${yearlyPrice(id).toLocaleString("en-US")}/year? You're charged now, minus a credit for the unused part of your current period.`) : undefined}>
                          {samePlan ? (interval === "year" ? `Switch to yearly (save $${plan.price * 12 - yearlyPrice(id)})` : "Switch to monthly")
                            : plan.price > state.plan.price ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
                        </SubmitButton>
                      </form>
                    ) : (
                      <CheckoutButton
                        priceId={priceId(id, interval)} token={process.env.PADDLE_CLIENT_TOKEN!.trim()} env={paddleEnv()} email={user.email}
                        userId={user.id} sig={checkoutSignature(user.id)} label="Start 14-day free trial" featured={featured}
                        autoOpen={chosen === id && period === interval && !messages.ok && !messages.error}
                      />
                    )}
                    {!subscribed && !current ? (
                      <p className="price-note" style={{ marginTop: 8, textAlign: "center" }}>
                        Then ${interval === "year" ? `${yearlyPrice(id).toLocaleString("en-US")}/year` : `${plan.price}/month`} · cancel before day 14 and pay nothing
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {subscribed ? <p className="faint">Changes take effect straight away and you pay only the difference for the rest of your current period. During the free trial, switching is free.</p> : null}
            {yearly ? <p className="faint">Yearly plans: 12 months for the price of {YEARLY_MONTHS}, paid once a year. The 14-day free trial and 14-day money-back guarantee apply too.</p> : null}
            {paddleEnv() === "sandbox" ? <p className="faint">Test mode: use card 4242 4242 4242 4242, any future date, CVC 100. No real money is charged.</p> : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
