import snapshot from "../data/snapshot.json";
import { ASSETS, KIND_LABEL, SYMBOLS, type MarketData, type Symbol } from "./types.ts";

const data = snapshot as unknown as MarketData;

export interface AssetProfile { symbol: Symbol; ret1y: number; vol: number; maxDrawdown: number }

/** Plain risk label from yearly volatility, for people who do not know what volatility is. */
export function riskLabel(vol: number): "Very low" | "Low" | "Medium" | "High" | "Very high" {
  return vol < 0.1 ? "Very low" : vol < 0.2 ? "Low" : vol < 0.4 ? "Medium" : vol < 0.7 ? "High" : "Very high";
}

/** Real stats per asset over the bundled history: last-year return, yearly volatility, worst fall. */
export function profiles(): AssetProfile[] {
  return SYMBOLS.map((s) => {
    const c = data.closes[s]!;
    const r = c.slice(1).map((v, i) => v / c[i] - 1);
    const m = r.reduce((a, x) => a + x, 0) / r.length;
    const vol = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(365);
    let peak = c[0], dd = 0;
    for (const v of c) { peak = Math.max(peak, v); dd = Math.max(dd, (peak - v) / peak); }
    const back = Math.min(365, c.length - 1);
    return { symbol: s, ret1y: c[c.length - 1] / c[c.length - 1 - back] - 1, vol, maxDrawdown: dd };
  });
}

/** The asset menu the AI advisor sees: what exists, what it is, where it lives, and how it really behaved. */
export function universeForPrompt(): string {
  return profiles()
    .map((p) => {
      const a = ASSETS[p.symbol];
      return `- ${p.symbol} | ${a.name} | ${KIND_LABEL[a.kind]} | on ${a.network} | last 12 months ${(p.ret1y * 100).toFixed(0)}% | yearly swings ${(p.vol * 100).toFixed(0)}% (${riskLabel(p.vol)} risk) | worst fall ${(p.maxDrawdown * 100).toFixed(0)}%`;
    })
    .join("\n");
}
