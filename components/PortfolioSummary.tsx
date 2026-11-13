import { useMemo } from "react";
import { portfolioValue, type Prices } from "@/lib/agent";
import { project } from "@/lib/montecarlo";
import type { Intent, MarketData, Strategy, Symbol } from "@/lib/types";
import { SYMBOLS } from "@/lib/types";
import { FanChart } from "./FanChart";

import { usd } from "@/lib/format";
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

/** Everything across all strategies: totals, exposure, worst case if every stop fires, combined projection. */
export function PortfolioSummary({ strategies, prices, market, now }: { strategies: Strategy[]; prices: Prices; market: MarketData | null; now: number }) {
  const active = strategies.filter((s) => s.status === "active");
  const key = active.map((s) => s.id).join(",");

  // Combined Monte Carlo of all running strategies treated as one book (each keeps its own stop; not modelled here).
  const combined = useMemo(() => {
    if (!market || active.length < 2) return null;
    const cap = active.reduce((a, s) => a + s.intent.capitalUsd, 0);
    const weights: Partial<Record<Symbol, number>> = {};
    for (const s of active) for (const k of SYMBOLS) if (s.intent.weights[k]) weights[k] = (weights[k] ?? 0) + (s.intent.weights[k]! * s.intent.capitalUsd) / cap;
    const remaining = Math.max(...active.map((s) => s.intent.horizonDays - ((now - (s.executedAt ?? now)) / 86_400_000)));
    const intent: Intent = {
      capitalUsd: cap, weights,
      targetRoi: active.reduce((a, s) => a + s.intent.capitalUsd * s.intent.targetRoi, 0) / cap,
      horizonDays: Math.max(1, Math.ceil(remaining)), stopLoss: null, prompt: "",
    };
    try {
      return { intent, p: project(market, intent, { paths: 3000, seed: 11 }) };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, market]);

  if (!strategies.length) return null;
  const invested = active.reduce((a, s) => a + s.intent.capitalUsd, 0);
  const value = active.reduce((a, s) => a + portfolioValue(s, prices), 0);
  const atRisk = active.reduce((a, s) => a + (s.intent.stopLoss != null ? s.intent.capitalUsd * s.intent.stopLoss : s.intent.capitalUsd), 0);
  const unstopped = active.filter((s) => s.intent.stopLoss == null).length;
  const realised = strategies.filter((s) => s.exitValue != null).reduce((a, s) => a + (s.exitValue! - s.intent.capitalUsd), 0);
  const exposure = SYMBOLS.map((k) => ({ k, v: active.reduce((a, s) => a + (s.units[k] ?? 0) * (prices[k] ?? 0), 0) })).filter((x) => x.v > 0);
  const cash = active.reduce((a, s) => a + s.cash, 0);
  const total = exposure.reduce((a, x) => a + x.v, 0) + cash;
  const by = (st: Strategy["status"]) => strategies.filter((s) => s.status === st).length;

  return (
    <section className="card">
      <h3>Portfolio · all strategies</h3>
      <div className="stats">
        <div className="stat"><div className="stat-v">{by("active")}</div><div className="stat-l">agents running</div></div>
        <div className="stat"><div className="stat-v">{by("draft")}</div><div className="stat-l">drafts</div></div>
        <div className="stat"><div className="stat-v">{by("stopped")}</div><div className="stat-l">stopped out</div></div>
        <div className="stat"><div className="stat-v">{usd(value)}</div><div className="stat-l">live value of {usd(invested)} deployed</div></div>
        <div className="stat">
          <div className={`stat-v ${value - invested >= 0 ? "good" : "bad"}`}>{value - invested >= 0 ? "+" : ""}{usd(value - invested)}</div>
          <div className="stat-l">unrealised P&amp;L</div>
        </div>
        <div className="stat"><div className={`stat-v ${realised >= 0 ? "good" : "bad"}`}>{realised >= 0 ? "+" : ""}{usd(realised)}</div><div className="stat-l">realised P&amp;L</div></div>
        {active.length > 0 && (
          <div className="stat" title="Sum of each agent's stop distance. Daily gaps can exceed it.">
            <div className="stat-v">{usd(atRisk)}</div>
            <div className="stat-l">max loss if every stop fires{unstopped ? ` (${unstopped} without a stop count full capital)` : ""}</div>
          </div>
        )}
      </div>

      {total > 0 && (
        <>
          <h4>Combined exposure</h4>
          <div className="expo">
            {exposure.map((x) => <div key={x.k} style={{ flex: x.v }} title={`${x.k} ${usd(x.v)}`}><b>{x.k}</b> {pct(x.v / total, 0)}</div>)}
            {cash > 0.005 && <div style={{ flex: cash }} className="cash"><b>USDC</b> {pct(cash / total, 0)}</div>}
          </div>
        </>
      )}

      {combined && (
        <>
          <h4>Running strategies as one book <span className="muted">({combined.intent.horizonDays}d left)</span></h4>
          <div className="stats">
            <div className="stat"><div className="stat-v">{pct(combined.p.probTarget, 0)}</div><div className="stat-l">chance of reaching +{pct(combined.intent.targetRoi, 1)} (blended goal)</div></div>
            <div className="stat"><div className="stat-v">{pct(combined.p.medianRoi)}</div><div className="stat-l">typical result</div></div>
            <div className="stat"><div className="stat-v">−{pct(Math.max(0, combined.p.var95))}</div><div className="stat-l">bad-case loss (1 in 20)</div></div>
            <div className="stat"><div className="stat-v">{pct(combined.p.portfolioVol, 0)}</div><div className="stat-l">yearly swings</div></div>
          </div>
          <FanChart p={combined.p} intent={combined.intent} />
          <p className="fine">Treats the strategies’ holdings as a single basket from today, without stop-losses, to show total concentration. Overlapping assets mean the strategies are less diversified than they look.</p>
        </>
      )}
    </section>
  );
}
