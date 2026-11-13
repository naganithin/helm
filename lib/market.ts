import { ASSETS, SYMBOLS } from "./types.ts";
import type { MarketData, Symbol } from "./types.ts";

// Crypto and gold: public Binance market-data mirror (no key, not geo-blocked like api.binance.com).
const KLINES = "https://data-api.binance.vision/api/v3/klines";
// US stocks and ETFs: Yahoo Finance's public chart endpoint (daily closes, split/dividend-adjusted "close" is not used; plain close).
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function binanceCloses(pair: string, days: number): Promise<Map<string, number>> {
  const res = await fetch(`${KLINES}?symbol=${pair}&interval=1d&limit=${days}`);
  if (!res.ok) throw new Error(`market data ${pair}: HTTP ${res.status}`);
  const rows = (await res.json()) as unknown[][];
  const out = new Map<string, number>();
  // Drop the in-progress candle (last row) so every close is final.
  for (const r of rows.slice(0, -1)) out.set(day(Number(r[0])), Number(r[4]));
  return out;
}

async function yahooCloses(ticker: string): Promise<Map<string, number>> {
  const res = await fetch(`${YAHOO}/${ticker}?range=2y&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`market data ${ticker}: HTTP ${res.status}`);
  const j = (await res.json()) as { chart: { result?: { timestamp: number[]; indicators: { quote: { close: (number | null)[] }[] } }[] } };
  const r = j.chart.result?.[0];
  if (!r) throw new Error(`market data ${ticker}: empty`);
  const out = new Map<string, number>();
  r.timestamp.forEach((t, i) => {
    const c = r.indicators.quote[0].close[i];
    if (c != null) out.set(day(t * 1000), c);
  });
  return out;
}

/**
 * Daily closes for every supported asset on one calendar. Crypto trades every day and sets the
 * calendar; stocks and ETFs are forward-filled over weekends and holidays (no move on days the
 * market is shut), and the calendar starts where every asset has data.
 */
export async function fetchMarket(days = 730): Promise<MarketData> {
  const maps = await Promise.all(
    SYMBOLS.map((s) => {
      const h = ASSETS[s].hist;
      return "binance" in h ? binanceCloses(h.binance, days) : yahooCloses(h.yahoo);
    }),
  );
  const crypto = SYMBOLS.map((s, i) => ({ s, m: maps[i] })).filter(({ s }) => "binance" in ASSETS[s].hist);
  const calendar = [...crypto[0].m.keys()].filter((d) => crypto.every(({ m }) => m.has(d))).sort();

  const filled = SYMBOLS.map((s, i) => {
    if ("binance" in ASSETS[s].hist) return calendar.map((d) => maps[i].get(d)!);
    const sorted = [...maps[i].entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    let p = -1;
    let last: number | undefined;
    return calendar.map((d) => {
      while (p + 1 < sorted.length && sorted[p + 1][0] <= d) last = sorted[++p][1];
      return last;
    });
  });
  const first = Math.max(...filled.map((c) => c.findIndex((v) => v != null)));
  const dates = calendar.slice(first);
  const closes: Partial<Record<Symbol, number[]>> = {};
  SYMBOLS.forEach((s, i) => (closes[s] = filled[i].slice(first) as number[]));
  return { source: "live", asOf: new Date().toISOString(), dates, closes };
}
