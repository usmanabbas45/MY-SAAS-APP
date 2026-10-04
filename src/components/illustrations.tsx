/**
 * Product illustrations for the marketing pages, drawn in HTML/CSS so they stay sharp,
 * follow light/dark mode and load instantly. All data shown is a sample, not a real customer.
 */
import { ScoreRing } from "@/components/ui";

/** Hero: a browser window with the ProofMyAI dashboard, plus a floating alert. */
export function HeroMockup() {
  const feed = [
    { ok: true, src: "Chatbot", text: "“Can I return opened items?” Answer matches Returns policy" },
    { ok: false, src: "Chatbot", text: "“Shipping to Leeds?” Said free shipping. Docs say £3.95 under £40" },
    { ok: true, src: "n8n", text: "Order sync: 128 orders processed in 4.2 s" },
    { ok: false, src: "Agent", text: "Refund agent looped 9 times on the same tool" },
    { ok: true, src: "Make", text: "Lead capture: 14 leads added to CRM" },
  ];
  return (
    <figure className="mock" role="img" aria-label="Example ProofMyAI dashboard: AI health score 86, live feed of checked chatbot answers and workflow runs, and a Slack alert">
      <div className="mock-window">
        <div className="mock-bar" aria-hidden>
          <span /><span /><span />
          <div className="mock-url">proofmyai.com/app</div>
        </div>
        <div className="mock-body" aria-hidden>
          <div className="mock-top">
            <ScoreRing score={86} size={112} />
            <div className="mock-stats">
              <div><strong>1,248</strong><small>answers checked</small></div>
              <div><strong className="t-bad">23</strong><small>made-up answers</small></div>
              <div><strong className="t-ok">99.2%</strong><small>workflow success</small></div>
            </div>
          </div>
          <div className="mock-feed-head"><span className="live-dot" /> Live feed</div>
          <ul className="mock-feed">
            {feed.map((f) => (
              <li key={f.text} className={f.ok ? "ok" : "bad"}>
                <span className="mock-mark">{f.ok ? "✓" : "✕"}</span>
                <span className="mock-src">{f.src}</span>
                <span className="mock-text">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mock-toast" aria-hidden>
        <div className="mock-toast-icon">🔔</div>
        <div>
          <strong>Alert sent to Slack</strong>
          <div>Order sync returned 0 orders 3 runs in a row</div>
        </div>
      </div>
      <div className="mock-chip" aria-hidden>🛡️ Personal data masked</div>
    </figure>
  );
}

/** A real-looking chat where the bot makes something up, and ProofMyAI's verdict. */
export function CatchDemo() {
  return (
    <div className="catch" role="img" aria-label="Example: a customer asks about shipping, the chatbot wrongly says it is free, and ProofMyAI flags it as made up with the fix">
      <div className="catch-chat" aria-hidden>
        <div className="catch-head"><span className="catch-avatar">🤖</span> Store assistant <span className="catch-online">online</span></div>
        <div className="bubble user">Hi! How much is delivery to Leeds for a £25 order?</div>
        <div className="bubble bot flagged">Great news, delivery is free on all UK orders! 🎉</div>
        <div className="bubble user">Perfect, ordering now 🙌</div>
      </div>
      <div className="catch-arrow" aria-hidden>→</div>
      <div className="catch-verdict" aria-hidden>
        <div className="row" style={{ gap: 8 }}>
          <span className="badge badge-bad">✕ Made up</span>
          <span className="badge">Risk: high</span>
        </div>
        <p className="catch-why"><strong>Your docs say:</strong> “Standard UK delivery is £3.95. Free on orders over £40.”</p>
        <div className="catch-fix">
          <div className="catch-fix-title">💡 Suggested fix</div>
          Add the delivery price table to the <em>Shipping rates</em> article. It caused 22 of 31 wrong answers this week.
        </div>
        <div className="catch-foot">Emailed to you · Posted in #support-ai</div>
      </div>
    </div>
  );
}

/** Small picture for each set-up step. */
export function StepArt({ step }: { step: 1 | 2 | 3 }) {
  if (step === 1) {
    return (
      <div className="step-art" aria-hidden>
        <div className="step-tiles">
          {["Intercom", "Tidio", "n8n", "Make", "API"].map((t) => <span key={t}>{t}</span>)}
        </div>
        <div className="step-plug">🔌 Connected</div>
      </div>
    );
  }
  if (step === 2) {
    return (
      <div className="step-art" aria-hidden>
        <div className="step-rows">
          <div><span className="t-ok">✓</span> Correct <i style={{ width: "78%" }} /></div>
          <div><span className="t-bad">✕</span> Made up <i className="bad" style={{ width: "14%" }} /></div>
          <div><span className="t-warn">!</span> Escalate <i className="warn" style={{ width: "8%" }} /></div>
        </div>
      </div>
    );
  }
  return (
    <div className="step-art" aria-hidden>
      <div className="step-alerts">
        <div><b>Slack</b> Answer quality dropped 12%</div>
        <div><b>Email</b> Weekly report ready</div>
        <div className="t-ok"><b>✓</b> All workflows healthy</div>
      </div>
    </div>
  );
}

const INTEGRATIONS: [string, string][] = [
  ["Intercom", "#1f8ded"], ["Tidio", "#0566ff"], ["Crisp", "#1972f5"], ["Zendesk", "#03363d"], ["Chatbase", "#111827"],
  ["Custom GPTs", "#10a37f"], ["n8n", "#ea4b71"], ["Make", "#6d00cc"], ["LangChain", "#1c3c3c"], ["OpenAI Agents", "#0f172a"],
  ["Claude agents", "#d97757"], ["WhatsApp", "#25d366"],
];

/** "Works with" strip: monogram tiles (not official logos). */
export function IntegrationStrip() {
  return (
    <div className="integrations">
      {INTEGRATIONS.map(([name, color]) => (
        <span key={name} className="integration">
          <span className="integration-mark" style={{ background: color }} aria-hidden>{name[0]}</span>
          {name}
        </span>
      ))}
    </div>
  );
}

const MORE_INTEGRATIONS: [string, string][] = [
  ["Twilio SMS", "#f22f46"], ["Zapier", "#ff4f00"], ["CrewAI", "#ef5b3f"], ["Slack alerts", "#4a154b"], ["Discord alerts", "#5865f2"],
  ["Any HTTP bot", "#5b4bf5"], ["Website widgets", "#0ea5e9"], ["Uptime checks", "#16a34a"],
];

function MarqueeRow({ items, reverse }: { items: [string, string][]; reverse?: boolean }) {
  // The list is rendered twice so the -50% scroll loops without a gap; the copy is hidden from screen readers.
  return (
    <div className={`marquee-row ${reverse ? "reverse" : ""}`}>
      {[0, 1].map((copy) => (
        <div className="marquee-track" key={copy} aria-hidden={copy === 1}>
          {items.map(([name, color]) => (
            <span key={name} className="integration">
              <span className="integration-mark" style={{ background: color }} aria-hidden>{name[0]}</span>
              {name}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Two rows of integrations drifting in opposite directions (pauses on hover, static with reduced motion). */
export function IntegrationMarquee() {
  return (
    <div className="marquee">
      <MarqueeRow items={INTEGRATIONS.slice(0, 7)} />
      <MarqueeRow items={[...INTEGRATIONS.slice(7), ...MORE_INTEGRATIONS]} reverse />
    </div>
  );
}
