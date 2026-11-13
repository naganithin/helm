import type { AssetStats, Intent, MarketData, Projection, Symbol } from "./types.ts";
import { SYMBOLS } from "./types.ts";

/** Deterministic PRNG so a projection is reproducible from (data, intent, seed). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const std = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
};
function quantile(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function maxDrawdown(series: number[]) {
  let peak = series[0];
  let dd = 0;
  for (const v of series) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, (peak - v) / peak);
  }
  return dd;
}

export function activeSymbols(intent: Intent): Symbol[] {
  return SYMBOLS.filter((s) => (intent.weights[s] ?? 0) > 0);
}

/**
 * Historical-bootstrap Monte Carlo. Each simulated day resamples one *whole day* of
 * observed returns across all assets, so cross-asset correlation, fat tails and
 * volatility clustering of the real sample are preserved (no normality assumption).
 * Holdings drift (buy-and-hold). If the stop-loss is set, a path exits to cash on the
 * first daily close at or below (1 - stopLoss) x capital and stays flat afterwards.
 */
export function project(
  data: MarketData,
  intent: Intent,
  opts: { paths?: number; seed?: number; drift?: "neutral" | "history" } = {},
): Projection {
  const paths = opts.paths ?? 5000;
  const seed = opts.seed ?? 42;
  const drift = opts.drift ?? "neutral";
  const symbols = activeSymbols(intent);
  if (!symbols.length) throw new Error("No allocated assets");
  const cashWeight = Math.max(0, 1 - symbols.reduce((s, k) => s + (intent.weights[k] ?? 0), 0));

  const series = symbols.map((s) => {
    const c = data.closes[s];
    if (!c || c.length < 60) throw new Error(`Not enough price history for ${s}`);
    return c;
  });
  const n = Math.min(...series.map((c) => c.length));
  const closes = series.map((c) => c.slice(c.length - n));
  // daily simple returns, rows = days, cols = assets
  const rets: number[][] = [];
  for (let d = 1; d < n; d++) rets.push(closes.map((c) => c[d] / c[d - 1] - 1));
  const T = rets.length;
  // "neutral": remove each asset's average past return so the simulation assumes no trend either way
  // (the last two years' drift, up or down, should not be projected forward). Volatility, correlation
  // and fat tails are untouched. "history" keeps the raw sample, drift included.
  const mu = closes.map((_, i) => (drift === "neutral" ? mean(rets.map((r) => r[i])) : 0));
  const sim = rets.map((row) => row.map((x, i) => x - mu[i]));
  const H = intent.horizonDays;
  const cap = intent.capitalUsd;
  const w = symbols.map((s) => intent.weights[s] ?? 0);
  const stopLevel = intent.stopLoss != null ? cap * (1 - intent.stopLoss) : -Infinity;

  const rand = mulberry32(seed);
  const days: number[][] = Array.from({ length: H + 1 }, () => new Array(paths));
  const finals = new Array<number>(paths);
  const dds = new Array<number>(paths);
  let stops = 0;

  for (let p = 0; p < paths; p++) {
    const val = w.map((x) => x * cap);
    let cash = cashWeight * cap;
    let stopped = false;
    let peak = cap;
    let dd = 0;
    days[0][p] = cap;
    for (let d = 1; d <= H; d++) {
      if (!stopped) {
        const row = sim[Math.floor(rand() * T)];
        let total = cash;
        for (let i = 0; i < val.length; i++) {
          val[i] *= 1 + row[i];
          total += val[i];
        }
        if (total <= stopLevel) {
          stopped = true;
          stops++;
          cash = total; // liquidated at the breaching close
          val.fill(0);
        }
        days[d][p] = total;
        peak = Math.max(peak, total);
        dd = Math.max(dd, (peak - total) / peak);
      } else {
        days[d][p] = cash;
      }
    }
    finals[p] = days[H][p];
    dds[p] = dd;
  }

  const fan = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };
  for (let d = 0; d <= H; d++) {
    const s = [...days[d]].sort((a, b) => a - b);
    fan.p5.push(quantile(s, 0.05));
    fan.p25.push(quantile(s, 0.25));
    fan.p50.push(quantile(s, 0.5));
    fan.p75.push(quantile(s, 0.75));
    fan.p95.push(quantile(s, 0.95));
  }
  const sortedFinal = [...finals].sort((a, b) => a - b);
  const roi = finals.map((v) => v / cap - 1);
  const sortedRoi = [...roi].sort((a, b) => a - b);
  const goals = [...new Set([0.03, 0.05, 0.1, 0.2, 0.3, intent.targetRoi].map((g) => Math.round(g * 1e4) / 1e4))].sort((a, b) => a - b);
  const ladder = goals.map((g) => ({ roi: g, prob: roi.filter((x) => x >= g).length / paths }));
  const k = Math.max(1, Math.floor(paths * 0.05));
  const tail = sortedRoi.slice(0, k);

  // per-asset historical stats (annualised, 365-day crypto year)
  const assets: AssetStats[] = symbols.map((s, i) => {
    const r = rets.map((row) => row[i]);
    const annReturn = Math.exp(mean(r.map((x) => Math.log(1 + x))) * 365) - 1;
    const annVol = std(r) * Math.sqrt(365);
    return {
      symbol: s,
      weight: w[i],
      annReturn,
      annVol,
      sharpe: annVol > 0 ? annReturn / annVol : 0,
      maxDrawdown: maxDrawdown(closes[i]),
      last: closes[i][closes[i].length - 1],
    };
  });
  // correlation matrix
  const cols = symbols.map((_, i) => rets.map((r) => r[i]));
  const correlation = cols.map((a, i) =>
    cols.map((b, j) => {
      if (i === j) return 1;
      const ma = mean(a), mb = mean(b);
      let sab = 0, saa = 0, sbb = 0;
      for (let t = 0; t < a.length; t++) {
        sab += (a[t] - ma) * (b[t] - mb);
        saa += (a[t] - ma) ** 2;
        sbb += (b[t] - mb) ** 2;
      }
      return sab / Math.sqrt(saa * sbb);
    }),
  );
  // historical portfolio daily vol with fixed weights (cash earns 0)
  const pr = rets.map((row) => row.reduce((s, x, i) => s + x * w[i], 0));

  return {
    paths,
    horizonDays: H,
    fan,
    expectedRoi: mean(roi),
    medianRoi: quantile(sortedRoi, 0.5),
    probTarget: roi.filter((x) => x >= intent.targetRoi).length / paths,
    probLoss: roi.filter((x) => x < 0).length / paths,
    probStop: stops / paths,
    var95: -quantile(sortedRoi, 0.05),
    cvar95: -mean(tail),
    medianMaxDrawdown: quantile([...dds].sort((a, b) => a - b), 0.5),
    portfolioVol: std(pr) * Math.sqrt(365),
    assets,
    symbols,
    correlation,
    ladder,
    historyDays: T,
    historyFrom: data.dates[data.dates.length - n] ?? "",
    historyTo: data.dates[data.dates.length - 1] ?? "",
    drift,
  };
}
