import { NextResponse } from "next/server";
import { fetchMarket } from "@/lib/market";
import type { MarketData } from "@/lib/types";

export const dynamic = "force-dynamic";
let cache: { at: number; data: MarketData } | null = null;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > 5 * 60_000) cache = { at: Date.now(), data: await fetchMarket() };
    return NextResponse.json(cache.data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "market data unavailable" }, { status: 502 });
  }
}
