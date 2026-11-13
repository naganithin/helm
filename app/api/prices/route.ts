import { NextResponse } from "next/server";
import { ASSETS, SYMBOLS } from "@/lib/types";

export const dynamic = "force-dynamic";

// One consistent, real market feed: crypto and gold from Binance, stocks/ETFs/bonds from Yahoo's live quote.
// (The exchange sandbox's own token prices can differ from the market by a few percent, which showed up as
// fake gains, so they are only a fallback.)
let cache: { at: number; prices: Record<string, number> } | null = null;

async function yahoo(ticker: string): Promise<number | undefined> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1m`, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
  if (!r.ok) return undefined;
  const j = (await r.json()) as { chart: { result?: { meta?: { regularMarketPrice?: number } }[] } };
  const p = j.chart.result?.[0]?.meta?.regularMarketPrice;
  return p && p > 0 ? p : undefined;
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.at < 12_000) return NextResponse.json({ prices: cache.prices, at: cache.at });
    const spot = await fetch("https://data-api.binance.vision/api/v3/ticker/price", { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ symbol: string; price: string }[]>;
    });
    const fallback = await fetch("https://www.usetidepool.tech/v0/tokens?ondoTokens=1", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ assetId: string; price: number }[]>) : []))
      .catch(() => [] as { assetId: string; price: number }[]);
    const prices: Record<string, number> = {};
    await Promise.all(SYMBOLS.map(async (s) => {
      const h = ASSETS[s].hist;
      if ("binance" in h) {
        const hit = spot.find((t) => t.symbol === h.binance);
        if (hit) prices[s] = Number(hit.price);
      } else {
        const live = await yahoo(h.yahoo).catch(() => undefined);
        const fb = fallback.find((t) => t.assetId === ASSETS[s].tp)?.price;
        const p = live ?? fb;
        if (p) prices[s] = p;
      }
    }));
    cache = { at: Date.now(), prices };
    return NextResponse.json({ prices, at: cache.at });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "prices unavailable" }, { status: 502 });
  }
}