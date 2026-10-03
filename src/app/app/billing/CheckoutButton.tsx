"use client";

import { useEffect, useRef, useState } from "react";
import { syncCheckoutAction } from "./actions";

interface PaddleEvent { name?: string; data?: { transaction_id?: string }; error?: { detail?: string; code?: string } }
interface PaddleJs {
  Environment: { set(env: string): void };
  Initialize(opts: { token: string; eventCallback: (e: PaddleEvent) => void }): void;
  Checkout: { open(opts: unknown): void; close(): void };
}
declare global { interface Window { Paddle?: PaddleJs } }

let loading: Promise<PaddleJs> | null = null;
let onEvent: (e: PaddleEvent) => void = () => {};

function loadPaddle(token: string, env: string): Promise<PaddleJs> {
  loading ??= new Promise<PaddleJs>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    s.async = true;
    s.onload = () => {
      const P = window.Paddle;
      if (!P) return reject(new Error("Paddle failed to load"));
      if (env === "sandbox") P.Environment.set("sandbox");
      P.Initialize({ token, eventCallback: (e) => onEvent(e) });
      resolve(P);
    };
    s.onerror = () => { loading = null; reject(new Error("Could not load the checkout. Check your connection or ad blocker.")); };
    document.head.appendChild(s);
  });
  return loading;
}

export function CheckoutButton(props: {
  priceId: string; token: string; env: string; email: string; userId: number; sig: string; label: string; featured?: boolean;
  /** Open the checkout straight away (the customer picked this plan on the pricing page before signing up). */
  autoOpen?: boolean;
}) {
  const [state, setState] = useState<"idle" | "opening" | "activating">("idle");
  const [error, setError] = useState("");

  async function open() {
    setError("");
    setState("opening");
    try {
      const P = await loadPaddle(props.token, props.env);
      onEvent = async (e) => {
        if (e.name === "checkout.completed" && e.data?.transaction_id) {
          setState("activating");
          // The subscription can take a few seconds to exist; retry, then fall back to the webhook.
          for (let i = 0; i < 8; i++) {
            if (await syncCheckoutAction(e.data.transaction_id)) break;
            await new Promise((r) => setTimeout(r, 2000));
          }
          P.Checkout.close();
          window.location.href = "/app/billing?ok=" + encodeURIComponent("Thank you! Your plan is active.");
        } else if (e.name === "checkout.error") {
          console.error("[paddle] checkout error", e);
          setError(`Checkout error: ${e.error?.detail ?? e.error?.code ?? "see the browser console (F12) for details"}`);
        } else if (e.name === "checkout.closed") {
          setState((s) => (s === "activating" ? s : "idle"));
        }
      };
      P.Checkout.open({
        items: [{ priceId: props.priceId, quantity: 1 }],
        customer: { email: props.email },
        customData: { user_id: String(props.userId), sig: props.sig },
        settings: { displayMode: "overlay", theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light", allowLogout: false },
      });
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the checkout.");
      setState("idle");
    }
  }

  const opened = useRef(false);
  useEffect(() => {
    if (props.autoOpen && !opened.current) {
      opened.current = true;
      void open();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoOpen]);

  return (
    <>
      <button type="button" className={props.featured ? "btn" : "btn btn-ghost"} style={{ width: "100%" }} onClick={open} disabled={state !== "idle"}>
        {state === "opening" ? "Opening checkout…" : state === "activating" ? "Activating your plan…" : props.label}
      </button>
      {error ? <p className="sub" style={{ color: "var(--bad)", marginTop: 8 }}>{error}</p> : null}
    </>
  );
}
