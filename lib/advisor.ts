import { project } from "./montecarlo.ts";
import { SYMBOLS, type Intent, type MarketData, type Symbol } from "./types.ts";

export interface Option {
  id: "gain" | "balanced" | "safe";
  title: string;
  blurb: string;
  weights: Partial<Record<Symbol, number>>;
  probTarget: number;
  probLoss: number;
  var95: number;
  medianRoi: number;
}
type Base = Pick<Intent, "capitalUsd" | "horizonDays" | "targetRoi" | "stopLoss">;
type Scored = Omit<Option, "id" | "title" | "blurb">;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const key = (w: Partial<Record<Symbol, number>>) => Object.entries(w).sort().map(([k, v]) => `${k}${Math.round(v! * 100)}`).join("-");

/** Singles, a few classic mixes, and seeded random 2-4 asset mixes in 5% steps. */
function candidates(): Partial<Record<Symbol, number>>[] {
  const out: Partial<Record<Symbol, number>>[] = SYMBOLS.map((s) => ({ [s]: 1 }));
  out.push({ SPY: 0.6, TLT: 0.4 }, { SPY: 0.4, AGG: 0.3, XAUT: 0.3 }, { BTC: 0.5, SPY: 0.5 }, { SGOV: 0.7, SPY: 0.3 });
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 220; i++) {
    const pick = [...SYMBOLS].sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 3));
    const raw = pick.map(() => rnd() + 0.15);
    const total = raw.reduce((a, b) => a + b, 0);
    const steps = raw.map((x) => Math.max(1, Math.round(((x / total) * 100) / 5)));
    steps[0] += 20 - steps.reduce((a, b) => a + b, 0); // keep the sum at exactly 100%
    if (steps[0] < 1) continue;
    out.push(Object.fromEntries(pick.map((p, j) => [p, steps[j] * 0.05])));
  }
  return out;
}

/**
 * For one goal and horizon, search many mixes with the same Monte Carlo and return three honest
 * choices: the mix most likely to reach the goal, the mix with the smallest bad case that still
 * has a real shot, and a balance between them. No mix beats the trade-off; this shows it.
 */
export async function compareOptions(data: MarketData, base: Base): Promise<Option[]> {
  const scored: Scored[] = [];
  const cands = candidates();
  for (let i = 0; i < cands.length; i++) {
    if (i % 20 === 0) await tick(); // keep the page responsive
    const p = project(data, { ...base, weights: cands[i], prompt: "" }, { paths: 800, seed: 11 });
    scored.push({ weights: cands[i], probTarget: p.probTarget, probLoss: p.probLoss, var95: p.var95, medianRoi: p.medianRoi });
  }
  const gain = [...scored].sort((a, b) => b.probTarget - a.probTarget || a.var95 - b.var95)[0];
  const used = new Set([key(gain.weights)]);
  const pick = (pool: Scored[], cmp: (a: Scored, b: Scored) => number) => {
    const s = pool.filter((x) => !used.has(key(x.weights))).sort(cmp)[0] ?? [...scored].filter((x) => !used.has(key(x.weights))).sort(cmp)[0];
    used.add(key(s.weights));
    return s;
  };
  const safe = pick(scored.filter((x) => x.probTarget >= gain.probTarget * 0.4), (a, b) => a.var95 - b.var95 || b.probTarget - a.probTarget);
  const balanced = pick(scored.filter((x) => x.var95 <= gain.var95 * 0.6 && x.var95 >= safe.var95), (a, b) => b.probTarget - a.probTarget || a.var95 - b.var95);
  return [
    { id: "safe", title: "Play it safe", blurb: "Smallest bad case that still has a real chance of the goal.", ...safe },
    { id: "balanced", title: "Balanced", blurb: "Gives up some chance of the goal for a much smaller bad case.", ...balanced },
    { id: "gain", title: "Go for the goal", blurb: "Highest chance of reaching the goal, with the biggest swings.", ...gain },
  ];
}
