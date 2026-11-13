import { NextResponse } from "next/server";
import { ASSETS } from "@/lib/types";

export const dynamic = "force-dynamic";
const API = "https://data-api.binance.vision/api/v3";
const SKIP = /^(USDC|FDUSD|TUSD|USDP|DAI|EUR|EURI|GBP|TRY|BRL|ARS|AEUR|USD1|XUSD|BFUSD|RLUSD|PAXG)$/;
const LEVERAGED = /(UP|DOWN|BULL|BEAR)$/;

export interface MarketRow {
  symbol: string;
  price: number;
  change24h: number; // percent
  volume: number; // USDT traded in 24h
  high: number;
  low: number;
  spark: number[]; // ~7 days, 4h closes
  tradable: boolean;
}

let cache: { at: number; rows: MarketRow[] } | null = null;

async function build(): Promise<MarketRow[]> {
  const res = await fetch(`${API}/ticker/24hr`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const all = (await res.json()) as { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string; highPrice: string; lowPrice: string }[];
  const tradableSyms = new Set(Object.keys(ASSETS));
  const rows = all
    .filter((t) => t.symbol.endsWith("USDT"))
    .map((t) => ({ t, base: t.symbol.slice(0, -4) }))
    .filter(({ base }) => !SKIP.test(base) && !LEVERAGED.test(base) && Number(base.length) <= 10)
    .sort((a, b) => Number(b.t.quoteVolume) - Number(a.t.quoteVolume));
  const top = rows.slice(0, 100);
  for (const s of tradableSyms) if (!top.some((r) => r.base === s)) { const hit = rows.find((r) => r.base === s); if (hit) top.push(hit); }

  return Promise.all(
    top.map(async ({ t, base }) => {
      let spark: number[] = [];
      try {
        const k = await fetch(`${API}/klines?symbol=${t.symbol}&interval=4h&limit=42`, { cache: "no-store" });
        if (k.ok) spark = ((await k.json()) as string[][]).map((r) => Number(r[4]));
      } catch {}
      return {
        symbol: base, price: Number(t.lastPrice), change24h: Number(t.priceChangePercent), volume: Number(t.quoteVolume),
        high: Number(t.highPrice), low: Number(t.lowPrice), spark, tradable: tradableSyms.has(base),
      };
    }),
  );
}

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > 20_000) cache = { at: Date.now(), rows: await build() };
    return NextResponse.json({ rows: cache.rows, at: cache.at });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "markets unavailable" }, { status: 502 });
  }
}
