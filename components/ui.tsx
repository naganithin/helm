"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** A change with a direction cue besides colour: ▲ 1.23% / ▼ 0.40%. `v` is already in percent. */
export function Delta({ v, digits = 2, suffix = "%", className = "" }: { v: number; digits?: number; suffix?: string; className?: string }) {
  const up = v >= 0;
  return (
    <span className={`delta ${up ? "good" : "bad"} ${className}`}>
      <i aria-hidden>{up ? "▲" : "▼"}</i>
      <span className="sr">{up ? "up " : "down "}</span>
      {Math.abs(v).toFixed(digits)}{suffix}
    </span>
  );
}

/** Placeholder shape for content that is still loading. */
export function Skel({ w = "100%", h = 14, r }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden />;
}

/** A few placeholder rows, announced once to screen readers. */
export function SkelRows({ n = 4, h = 44, label = "Loading" }: { n?: number; h?: number; label?: string }) {
  return (
    <div className="skel-rows" role="status" aria-label={label}>
      {Array.from({ length: n }, (_, i) => <Skel key={i} h={h} r={12} />)}
    </div>
  );
}

/** The real stage a slow action is in, with a spinner. */
export function Stage({ text }: { text?: string }) {
  if (!text) return null;
  return <div className="stage" role="status"><span className="spinner" aria-hidden />{text}…</div>;
}

/** An in-app confirmation that states the consequence; Escape or the backdrop cancels. */
export function Confirm({ title, children, confirm, danger, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirm: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ok.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="scrim" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="muted">{children}</div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button ref={ok} className={`btn ${danger ? "danger solid" : "primary"}`} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
