// Measures how well the Monte Carlo is calibrated on the bundled real history and writes data/backtest.json.
// Run: npm run backtest
import { readFileSync, writeFileSync } from "node:fs";
import { calibrate } from "../lib/backtest.ts";

const data = JSON.parse(readFileSync(new URL("../data/snapshot.json", import.meta.url), "utf8"));
const PORTFOLIOS = [
  ["Crypto mix (60% BTC, 30% ETH, 10% NEAR)", { BTC: 0.6, ETH: 0.3, NEAR: 0.1 }],
  ["Bitcoin only", { BTC: 1 }],
  ["Classic 60/40 (S&P 500 + Treasuries)", { SPY: 0.6, TLT: 0.4 }],
  ["Tech stocks (NVDA, TSLA, AAPL)", { NVDA: 0.34, TSLA: 0.33, AAPL: 0.33 }],
  ["Diversified (BTC, S&P 500, gold, bonds)", { BTC: 0.25, SPY: 0.25, GLD: 0.25, AGG: 0.25 }],
];
const rows = [];
for (const [name, w] of PORTFOLIOS)
  for (const horizon of [30, 60])
    for (const drift of ["neutral", "history"]) rows.push({ name, horizon, drift, ...calibrate(data, w, horizon, drift) });

const pool = (drift) => {
  const r = rows.filter((x) => x.drift === drift);
  const n = r.reduce((a, x) => a + x.n, 0);
  const avg = (k) => r.reduce((a, x) => a + x[k] * x.n, 0) / n;
  return { n, inside90: avg("inside90"), inside50: avg("inside50"), below5: avg("below5"), above95: avg("above95") };
};
const out = {
  generatedAt: new Date().toISOString(),
  historyDays: data.dates.length, from: data.dates[0], to: data.dates.at(-1), minHistory: 250,
  summary: { neutral: pool("neutral"), history: pool("history") }, rows,
};
writeFileSync(new URL("../data/backtest.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary, null, 1));
for (const r of rows) console.log(r.drift.padEnd(8), String(r.horizon).padStart(3), r.name.padEnd(42), `n=${r.n} in90=${(r.inside90 * 100).toFixed(0)}% in50=${(r.inside50 * 100).toFixed(0)}% <p5=${(r.below5 * 100).toFixed(0)}% >p95=${(r.above95 * 100).toFixed(0)}% bias=${(r.medianError * 100).toFixed(1)}%`);
