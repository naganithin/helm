import { project } from "./montecarlo.ts";
import type { Intent, MarketData, Symbol } from "./types.ts";

export interface Calibration {
  n: number; // number of past start dates tested
  inside90: number; // share of real outcomes inside the model's 5-95% range (ideal 0.90)
  inside50: number; // share inside the 25-75% range (ideal 0.50)
  below5: number; // real outcome was worse than the model's 5th percentile (ideal 0.05)
  above95: number; // real outcome was better than the 95th percentile (ideal 0.05)
  medianError: number; // median of (real return - model median return), a bias check
}

/**
 * Rolling-origin backtest. At each past start date the model sees ONLY the history before it,
 * forecasts the next `horizon` days, and we compare with what the buy-and-hold basket really did.
 * Start dates overlap when the horizon is long, so treat n as an upper bound on independent tests.
 */
export function calibrate(
  data: MarketData,
  weights: Partial<Record<Symbol, number>>,
  horizon: number,
  drift: "neutral" | "history",
  opts: { minHistory?: number; step?: number; paths?: number } = {},
): Calibration {
  const minHistory = opts.minHistory ?? 250;
  const step = opts.step ?? 10;
  const syms = Object.keys(weights) as Symbol[];
  const total = data.dates.length;
  let n = 0, in90 = 0, in50 = 0, lo = 0, hi = 0;
  const errs: number[] = [];
  for (let t = minHistory; t + horizon < total; t += step) {
    const seen: MarketData = { ...data, dates: data.dates.slice(0, t + 1), closes: Object.fromEntries(syms.map((s) => [s, data.closes[s]!.slice(0, t + 1)])) };
    const intent: Intent = { capitalUsd: 1000, weights, targetRoi: 0, horizonDays: horizon, stopLoss: null, prompt: "" };
    const p = project(seen, intent, { paths: opts.paths ?? 600, seed: t, drift });
    const cash = 1 - syms.reduce((a, s) => a + weights[s]!, 0);
    const real = 1000 * (cash + syms.reduce((a, s) => a + (weights[s]! * data.closes[s]![t + horizon]) / data.closes[s]![t], 0));
    n++;
    if (real >= p.fan.p5[horizon] && real <= p.fan.p95[horizon]) in90++;
    if (real >= p.fan.p25[horizon] && real <= p.fan.p75[horizon]) in50++;
    if (real < p.fan.p5[horizon]) lo++;
    if (real > p.fan.p95[horizon]) hi++;
    errs.push((real - p.fan.p50[horizon]) / 1000);
  }
  errs.sort((a, b) => a - b);
  return { n, inside90: in90 / n, inside50: in50 / n, below5: lo / n, above95: hi / n, medianError: errs[Math.floor(errs.length / 2)] ?? 0 };
}
