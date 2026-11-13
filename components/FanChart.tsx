import type { Intent, Projection } from "@/lib/types";

const W = 680, H = 280, PAD = { l: 56, r: 128, t: 14, b: 26 };
const usd = (v: number) => `$${v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2)}`;

/** Push labels apart so they never overlap. */
function spread(ys: number[], gap = 14): number[] {
  const idx = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const out = [...ys];
  let last = -Infinity;
  for (const [y, i] of idx) { out[i] = Math.max(y, last + gap); last = out[i]; }
  return out;
}

/**
 * The forecast as a fan: a good run, a typical run and a rough patch, with the user's goal and
 * safety-sell level drawn in plain words. Everything is labelled directly, no legend decoding.
 */
export function FanChart({ p, intent }: { p: Projection; intent: Intent }) {
  const goal = intent.capitalUsd * (1 + intent.targetRoi);
  const stop = intent.stopLoss != null ? intent.capitalUsd * (1 - intent.stopLoss) : null;
  const vals = [...p.fan.p5, ...p.fan.p95, goal, ...(stop ? [stop] : [])];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (d: number) => PAD.l + (d / p.horizonDays) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const line = (a: number[]) => a.map((v, d) => `${d ? "L" : "M"}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const band = (a: number[], b: number[]) =>
    `${line(a)}${b.map((_, i) => `L${x(b.length - 1 - i).toFixed(1)},${y(b[b.length - 1 - i]).toFixed(1)}`).join("")}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
  const end = p.horizonDays;
  const labels: { text: string; v: number; cls: string }[] = [
    { text: `Good run ${usd(p.fan.p95[end])}`, v: p.fan.p95[end], cls: "axis good" },
    { text: `Typical ${usd(p.fan.p50[end])}`, v: p.fan.p50[end], cls: "axis acc" },
    { text: `Rough patch ${usd(p.fan.p5[end])}`, v: p.fan.p5[end], cls: "axis bad" },
    { text: `Your goal ${usd(goal)}`, v: goal, cls: "axis good" },
    ...(stop ? [{ text: `Auto-sell ${usd(stop)}`, v: stop, cls: "axis bad" }] : []),
  ];
  const ly = spread(labels.map((l) => y(l.v) + 4));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
      aria-label={`Your ${usd(intent.capitalUsd)} after ${end} days: typical ${usd(p.fan.p50[end])}, good run ${usd(p.fan.p95[end])}, rough patch ${usd(p.fan.p5[end])}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{usd(t)}</text>
        </g>
      ))}
      <path d={band(p.fan.p5, p.fan.p95)} className="band outer" />
      <path d={band(p.fan.p25, p.fan.p75)} className="band inner" />
      <line x1={PAD.l} x2={W - PAD.r} y1={y(intent.capitalUsd)} y2={y(intent.capitalUsd)} className="start" />
      <line x1={PAD.l} x2={W - PAD.r} y1={y(goal)} y2={y(goal)} className="tgt" />
      {stop && <line x1={PAD.l} x2={W - PAD.r} y1={y(stop)} y2={y(stop)} className="stp" />}
      <path d={line(p.fan.p95)} className="edge good" fill="none" pathLength={1} />
      <path d={line(p.fan.p5)} className="edge bad" fill="none" pathLength={1} />
      <path d={line(p.fan.p50)} className="median" fill="none" pathLength={1} />
      {labels.map((l, i) => <text key={l.text} x={W - PAD.r + 8} y={ly[i]} className={l.cls}>{l.text}</text>)}
      <text x={PAD.l} y={H - 7} className="axis">Today ({usd(intent.capitalUsd)})</text>
      <text x={W - PAD.r} y={H - 7} textAnchor="end" className="axis">in {end} day{end === 1 ? "" : "s"}</text>
    </svg>
  );
}
