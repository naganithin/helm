"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Ticker, useMarkets } from "./Market";

export function LiveTicker() {
  const { rows } = useMarkets();
  return <Ticker rows={rows} />;
}

/** Fades and lifts its content into view the first time it scrolls on screen. */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { el.classList.add("in"); return; }
    const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${className}`} style={{ ["--d" as string]: `${delay}s` }}>{children}</div>;
}

/** Quiet market-style lines that draw themselves behind the hero. Decorative only. */
export function HeroGraphic() {
  return (
    <svg className="hero-bg" viewBox="0 0 1200 460" preserveAspectRatio="none" aria-hidden>
      {[80, 160, 240, 320, 400].map((y) => <line key={y} className="gridline" x1="0" x2="1200" y1={y} y2={y} />)}
      <path pathLength={1} d="M0 330 C120 300 180 360 290 300 S470 190 580 240 S760 340 880 220 S1080 120 1200 150" />
      <path pathLength={1} d="M0 380 C140 350 220 400 340 350 S520 260 640 300 S800 380 930 290 S1100 220 1200 240" />
      <path pathLength={1} d="M0 270 C100 250 200 300 320 250 S500 150 620 190 S820 260 940 160 S1120 90 1200 110" />
    </svg>
  );
}