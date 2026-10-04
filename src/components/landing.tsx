"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** True when the visitor asked the OS for less motion: no auto-advance and no autoplay. */
function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** Tracks whether an element is on screen (threshold = share of it that must be visible). */
function useInView<T extends Element>(threshold: number) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

function track(event: string, params: Record<string, string> = {}) {
  const w = window as unknown as { gtag?: (...a: unknown[]) => void };
  w.gtag?.("event", event, params);
}

/**
 * Button-like link with a one-key keyboard shortcut (shown as a <kbd>). The key is ignored while
 * the visitor is typing in a field or holding a modifier, so it never hijacks normal typing.
 */
export function ShortcutLink({ href, k, className, children, event }: { href: string; k: string; className?: string; children: ReactNode; event?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== k || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (event) track(event, { via: "shortcut" });
      if (href.startsWith("#")) document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.location.href = href;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [href, k, event]);
  return (
    <a href={href} className={className} onClick={() => event && track(event, { via: "click" })}>
      {children}<kbd className="kbd" aria-hidden>{k.toUpperCase()}</kbd>
    </a>
  );
}

export type TourTab = { id: string; name: string; subtitle: string; img: string; alt: string };

const TOUR_INTERVAL_MS = 5000;

/**
 * Product tour: real screenshots behind clickable tabs. While the tour is on screen it moves to the
 * next tab every 5 seconds (with a progress bar on the active tab); clicking a tab stops that.
 * Hovering pauses it. "Watch demo" swaps the screenshot for the demo video.
 */
export function ProductTour({ tabs, video, poster }: { tabs: TourTab[]; video: string; poster: string }) {
  const [active, setActive] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [hover, setHover] = useState(false);
  const [demo, setDemo] = useState(false);
  const reduce = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.35);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const running = !stopped && !hover && !demo && inView && !reduce;

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setActive((i) => (i + 1) % tabs.length), TOUR_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [running, active, tabs.length]);

  const choose = useCallback((i: number) => {
    setStopped(true);
    setDemo(false);
    setActive(i);
    track("tour_tab", { tab: tabs[i].id });
  }, [tabs]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = tabs.length;
    let i = active;
    if (e.key === "ArrowRight") i = (active + 1) % n;
    else if (e.key === "ArrowLeft") i = (active - 1 + n) % n;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = n - 1;
    else return;
    e.preventDefault();
    choose(i);
    tabRefs.current[i]?.focus();
  };

  return (
    <div ref={ref} className="tour" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="tour-head">
        <div className="tour-tabs" role="tablist" aria-label="Product tour. Use the arrow keys to switch screens." onKeyDown={onKeyDown}>
          {tabs.map((t, i) => {
            const on = i === active && !demo;
            return (
              <button
                key={t.id}
                ref={(el) => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`tour-tab-${t.id}`}
                aria-selected={on}
                aria-controls="tour-panel"
                tabIndex={i === active ? 0 : -1}
                className={`tour-tab ${on ? "on" : ""}`}
                onClick={() => choose(i)}
              >
                {t.name}
                {on && running ? <span key={`${t.id}-${active}`} className="tour-progress" style={{ animationDuration: `${TOUR_INTERVAL_MS}ms` }} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm tour-demo"
          aria-pressed={demo}
          aria-controls="tour-panel"
          onClick={() => { setDemo((d) => !d); if (!demo) track("tour_watch_demo"); }}
        >
          {demo ? "✕ Close demo" : "▶ Watch demo"}
        </button>
      </div>
      <p className="tour-sub" key={demo ? "demo" : tabs[active].id} aria-live="polite">
        {demo ? "75-second walkthrough of ProofMyAI." : tabs[active].subtitle}
      </p>
      <div className="tour-frame" id="tour-panel" role="tabpanel" aria-labelledby={demo ? undefined : `tour-tab-${tabs[active].id}`}>
        <div className="tour-bar" aria-hidden><i /><i /><i /><span>app.proofmyai.com</span></div>
        <div className="tour-screen">
          {demo ? (
            <video src={video} poster={poster} autoPlay controls playsInline className="tour-video" />
          ) : (
            tabs.map((t, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={t.id}
                src={t.img}
                alt={t.alt}
                width={1600}
                height={1000}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                className={i === active ? "on" : ""}
                aria-hidden={i !== active}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Demo video that starts playing (muted, looping) when it scrolls into view and pauses when it
 * leaves, like a GIF. "Play with sound" restarts it from the beginning with sound and controls.
 * Nothing is downloaded until the video comes near the screen.
 */
export function ScrollVideo({ src, webm, poster, title }: { src: string; webm?: string; poster: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [wrapRef, inView] = useInView<HTMLDivElement>(0.5);
  const [sound, setSound] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const v = videoRef.current;
    if (!v || sound) return;
    if (inView && !reduce) v.play().catch(() => { /* autoplay refused: the poster and button stay */ });
    else v.pause();
  }, [inView, reduce, sound]);

  const playWithSound = () => {
    const v = videoRef.current;
    if (!v) return;
    setSound(true);
    v.muted = false;
    v.loop = false;
    v.currentTime = 0;
    v.play().catch(() => {});
    track("video_sound_on");
  };

  return (
    <div ref={wrapRef} className="video scroll-video">
      <video
        ref={videoRef}
        poster={poster}
        muted={!sound}
        loop={!sound}
        playsInline
        preload="none"
        controls={sound}
        title={title}
        aria-label={title}
      >
        <source src={src} type="video/mp4" />
        {webm ? <source src={webm} type="video/webm" /> : null}
      </video>
      {!sound ? (
        <button type="button" className="video-sound" onClick={playWithSound}>
          🔊 Play with sound
        </button>
      ) : null}
    </div>
  );
}

/** Text box with a Copy button (falls back to selecting the text when the clipboard is blocked). */
export function CopyBox({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const r = document.createRange();
      if (pre.current) r.selectNodeContents(pre.current);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
      return;
    }
    setCopied(true);
    track("copy_snippet", { what: label });
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="copy-box">
      <button type="button" className="btn btn-ghost btn-sm copy-btn" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? "✓ Copied" : "Copy"}
      </button>
      <pre ref={pre}><code>{text}</code></pre>
    </div>
  );
}

export type StartTab = { id: string; label: string; body: ReactNode };

/** Small tab switcher for the "Get started" section. */
export function StartTabs({ tabs }: { tabs: StartTab[] }) {
  const [active, setActive] = useState(0);
  return (
    <div className="start-tabs">
      <div className="seg" role="tablist" aria-label="How do you want to start?">
        {tabs.map((t, i) => (
          <button key={t.id} type="button" role="tab" id={`start-${t.id}`} aria-selected={i === active} aria-controls="start-panel" className={i === active ? "on" : ""} onClick={() => setActive(i)}>
            {t.label}
          </button>
        ))}
      </div>
      <div id="start-panel" role="tabpanel" aria-labelledby={`start-${tabs[active].id}`} className="start-panel">
        {tabs[active].body}
      </div>
    </div>
  );
}

/**
 * Rotating words (Magic UI "word rotate"): every word sits in the same grid cell so the line is as wide
 * as the longest word and nothing below jumps. Screen readers get the first word only.
 */
export function WordRotate({ words, interval = 2400 }: { words: string[]; interval?: number }) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => clearInterval(t);
  }, [reduce, words.length, interval]);
  return (
    <>
      <span className="sr-only">{words[0]}</span>
      <span className="word-rotate" aria-hidden>
        {words.map((w, n) => <span key={w} className={n === i ? "on" : ""}>{w}</span>)}
      </span>
    </>
  );
}

/** Counts up from 0 to the value the first time it scrolls into view (Magic UI "number ticker"). */
export function NumberTicker({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>(0.6);
  const [n, setN] = useState(value);
  const done = useRef(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!inView || done.current || reduce) return;
    done.current = true;
    const start = performance.now(), dur = 1400;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    setN(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, value]);
  return <span ref={ref} className="ticker">{prefix}{n.toLocaleString("en-US")}{suffix}</span>;
}

/**
 * Cursor spotlight for cards (Aceternity "card spotlight" / Magic UI "magic card"): one listener for
 * the whole page writes the pointer position into the hovered `.spot` element as --mx / --my.
 */
export function PointerGlow() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = (e.target as Element | null)?.closest?.(".spot") as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => { document.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
