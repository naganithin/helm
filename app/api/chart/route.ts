import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const RANGES: Record<string, { interval: string; limit: number }> = {
  "1D": { interval: "15m", limit: 96 },
  "7D": { interval: "1h", limit: 168 },
  "30D": { interval: "4h", limit: 180 },
  "1Y": { interval: "1d", limit: 365 },
};

export async function GET(req: Request) {
  const u = new URL(req.url);
  const symbol = (u.searchParams.get("symbol") ?? "").toUpperCase();
  const range = RANGES[u.searchParams.get("range") ?? "7D"];
  if (!/^[A-Z0-9]{2,12}$/.test(symbol) || !range) return NextResponse.json({ error: "bad symbol or range" }, { status: 400 });
  try {
    const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}USDT&interval=${range.interval}&limit=${range.limit}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as string[][];
    return NextResponse.json({ symbol, points: rows.map((r) => [Number(r[0]), Number(r[4])]), highs: rows.map((r) => Number(r[2])), lows: rows.map((r) => Number(r[3])) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "chart unavailable" }, { status: 502 });
  }
}
