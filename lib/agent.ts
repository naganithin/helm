import type { Intent, Strategy, Symbol } from "./types.ts";
import { SYMBOLS } from "./types.ts";

export type Prices = Partial<Record<Symbol, number>>;
export type Decision = "hold" | "stop-loss" | "take-profit" | "expired";

export function portfolioValue(s: Pick<Strategy, "units" | "cash">, prices: Prices): number {
  return SYMBOLS.reduce((v, k) => v + (s.units[k] ?? 0) * (prices[k] ?? 0), s.cash);
}

/** USD to put into each risk asset for a given capital. The unallocated remainder stays USDC. */
export function allocation(intent: Intent, capital: number): { symbol: Symbol; usd: number }[] {
  return SYMBOLS.filter((k) => (intent.weights[k] ?? 0) > 0).map((k) => ({ symbol: k, usd: intent.weights[k]! * capital }));
}

/**
 * The agent's risk rule. Same trigger the Monte Carlo assumes: exit when marked-to-market
 * value is at or below (1 - stopLoss) x capital. Also closes at the end of the horizon.
 */
export function decide(s: Strategy, prices: Prices, now: number): Decision {
  if (s.status !== "active") return "hold";
  const { stopLoss, capitalUsd, horizonDays } = s.intent;
  // Never judge a position on a missing or broken quote: an absent price would read as $0 and fire a false stop-loss.
  const blind = SYMBOLS.some((k) => (s.units[k] ?? 0) > 0 && !(Number.isFinite(prices[k]) && (prices[k] as number) > 0));
  if (!blind && stopLoss != null && portfolioValue(s, prices) <= capitalUsd * (1 - stopLoss)) return "stop-loss";
  // the goal reached: lock it in (a goal of 0% or less means "no take-profit")
  if (!blind && s.intent.targetRoi > 0 && portfolioValue(s, prices) >= capitalUsd * (1 + s.intent.targetRoi)) return "take-profit";
  if (s.executedAt != null && now >= s.executedAt + horizonDays * 86_400_000) return "expired";
  return "hold";
}
