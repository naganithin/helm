"use client";
import { useId, useMemo, useState } from "react";
import { usd } from "@/lib/format";

type Range = "1D" | "1W" | "All";
const SPAN: Record<Range, number> = { "1D": 86_400_000, "1W": 7 * 86_400_000, All: Infinity };

/** Portfolio value over time: gridlines, a range selector and a hover readout. Needs at least two points. */
export function AreaChart({ data, height = 200 }: { data: { t: number; v: number }[]; height?: number }) {
  const [range, setRange] = useState<Range>("All");
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const W = 640, H = height, P = { l: 8, r: 8, t: 14, b: 22 };

  const pts = useMemo(() => {
    if (data.length < 2) return data;
    const end = data[data.length - 1].t;
    const cut = data.filter((d) => end - d.t <= SPAN[range]);
    return cut.length >= 2 ? cut : data;
  }, [data, range]);

  if (data.length < 2) {
    return (
      <div className="chart-empty" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden><path d={`M${P.l},${H * 0.6} C ${W * 0.25},${H * 0.45} ${W * 0.4},${H * 0.75} ${W * 0.6},${H * 0.5} S ${W * 0.9},${H * 0.4} ${W - P.r},${H * 0.3}`} fill="none" stroke="var(--line2)" strokeWidth="2" strokeDasharray="5 6" /></svg>
        <span className="small muted">Your value history draws here as prices move.</span>
      </div>
    );
  }

  const vs = pts.map((d) => d.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  // never zoom into noise: a $10 move on $25,000 should look like the small change it is
  const minSpan = Math.max(Math.abs(hi) * 0.02, 1);
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const x = (i: number) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const line = pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join("");
  const up = pts[pts.length - 1].v >= pts[0].v;
  const c = up ? "var(--good)" : "var(--bad)";
  const grid = [0.2, 0.5, 0.8].map((f) => hi - (hi - lo) * f);
  const last = pts.length - 1;
  const hv = hover != null ? pts[hover] : null;
  const fmtT = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between">
        <span className="fine">{fmtT(pts[0].t)} to now</span>
        <div className="ranges" role="group" aria-label="Chart range">
          {(["1D", "1W", "All"] as Range[]).map((r) => <button key={r} className={r === range ? "on" : ""} aria-pressed={r === range} onClick={() => setRange(r)}>{r}</button>)}
        </div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="chart" role="img"
          aria-label={`Portfolio value from ${usd(pts[0].v)} to ${usd(pts[last].v)}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - b.left) / b.width) * W;
            setHover(Math.max(0, Math.min(last, Math.round(((px - P.l) / (W - P.l - P.r)) * last))));
          }}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: c, stopOpacity: 0.22 }} />
              <stop offset="1" style={{ stopColor: c, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {grid.map((g) => (
            <g key={g}>
              <line x1={P.l} x2={W - P.r} y1={y(g)} y2={y(g)} className="grid" />
              <text x={W - P.r} y={y(g) - 4} textAnchor="end" className="axis">{usd(g)}</text>
            </g>
          ))}
          <path className="areafill" d={`${line}L${x(last)},${H - P.b}L${x(0)},${H - P.b}Z`} fill={`url(#${gid})`} />
          <path className="draw" pathLength={1} d={line} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />
          <circle className="live-dot" cx={x(last)} cy={y(pts[last].v)} r="4.5" fill={c} />
          {hover != null && hv && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="cross" />
              <circle cx={x(hover)} cy={y(hv.v)} r="4" fill="var(--ink)" />
            </>
          )}
        </svg>
        {hover != null && hv && (
          <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>{usd(hv.v)}</b>{fmtT(hv.t)}
          </div>
        )}
      </div>
    </div>
  );
}

// category colours: an evenly spaced chart palette per tone (see --c1..--c7 in globals.css)
export const PALETTE = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)", "var(--dim)"];

/** Allocation ring with the total in the middle. */
export function Donut({ slices, center, sub }: { slices: { label: string; value: number }[]; center: string; sub: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 62, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 170 170" width="170" height="170" role="img" aria-label={`Allocation of ${center}`}>
      <circle cx="85" cy="85" r={R} fill="none" stroke="var(--line)" strokeWidth="20" />
      {total > 0 && slices.map((s, i) => {
        const len = (s.value / total) * C;
        const el = <circle key={s.label} className="dseg" cx="85" cy="85" r={R} fill="none" strokeWidth="20" style={{ stroke: PALETTE[i % PALETTE.length], ["--i" as string]: i, ["--C" as string]: C }} strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 85 85)" />;
        acc += len;
        return el;
      })}
      <text x="85" y="84" textAnchor="middle" className="donut-v">{center}</text>
      <text x="85" y="102" textAnchor="middle" className="axis">{sub}</text>
    </svg>
  );
}
