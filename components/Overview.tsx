"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { portfolioValue } from "@/lib/agent";
import { pct, signedUsd, usd } from "@/lib/format";
import { ASSETS, SYMBOLS } from "@/lib/types";
import { AreaChart, Donut, PALETTE } from "./Charts";
import { CountUp } from "./CountUp";
import { fmtPrice, Spark, type MarketRow } from "./Market";
import type { View } from "./Trade";
import { Delta, Skel, SkelRows } from "./ui";
import type { Helm } from "./useHelm";

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="kpi">
      <div className="kpi-l">{label}</div>
      <div className={`kpi-v ${tone ?? ""}`}>{value}</div>
      {sub && <div className="kpi-s">{sub}</div>}
    </div>
  );
}

/** "updated 8s ago", refreshed every few seconds. */
function Fresh({ at }: { at?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  if (!at) return null;
  const s = Math.max(0, Math.round((now - at) / 1000));
  return <div className="fresh"><span className="dot" aria-hidden />Prices · Binance &amp; Yahoo · updated {s < 60 ? `${s}s` : `${Math.round(s / 60)}m`} ago</div>;
}

/** The investor's home: total value and its history, what the money is in, what is running, and what the market is doing. */
export function Overview({ h, rows, at, go, onIdea }: { h: Helm; rows: MarketRow[]; at?: number; go: (v: View) => void; onIdea: (prompt: string) => void }) {
  const running = h.strategies.filter((s) => s.status === "active");
  const invested = running.reduce((a, s) => a + s.intent.capitalUsd, 0);
  const unrealised = h.deployed - invested;
  const realised = h.strategies.filter((s) => s.exitValue != null).reduce((a, s) => a + (s.exitValue! - s.intent.capitalUsd), 0);
  const first = h.history[0]?.v;
  const change = first ? (h.total - first) / first : 0;
  const firstRun = !h.demo && h.strategies.length === 0 && h.total < 0.01 && !h.history.some((p) => p.v > 0);

  const slices = useMemo(() => {
    const out: { label: string; value: number }[] = [];
    for (const k of SYMBOLS) {
      const v = running.reduce((a, s) => a + (s.units[k] ?? 0) * (h.prices[k] ?? 0), 0);
      if (v > 0.005) out.push({ label: k, value: v });
    }
    const cash = h.free + running.reduce((a, s) => a + s.cash, 0);
    if (cash > 0.005) out.push({ label: "Cash (USDC)", value: cash });
    return out.sort((a, b) => b.value - a.value);
  }, [running, h.prices, h.free]);
  const sliceTotal = slices.reduce((a, s) => a + s.value, 0);

  const movers = useMemo(() => {
    const liquid = rows.filter((r) => r.volume > 5e6);
    const by = [...liquid].sort((a, b) => b.change24h - a.change24h);
    return { up: by.slice(0, 4), down: by.slice(-4).reverse() };
  }, [rows]);
  const watch = rows.filter((r) => r.tradable);

  return (
    <section className="view">
      {firstRun && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="eyebrow">Get started</div>
          <div className="firstrun">
            <div className="frstep done"><span className="n" aria-hidden>✓</span><div><b>Connect your NEAR wallet</b><div className="small muted">Done. Your Helm wallet is tied to it.</div></div></div>
            <div className="frstep now"><span className="n">2</span><div className="col" style={{ gap: 8 }}><div><b>Add funds</b><div className="small muted">Send USDC from your NEAR wallet.</div></div><div><button className="btn primary sm" onClick={() => go("wallet")}>Add funds</button></div></div></div>
            <div className="frstep"><span className="n">3</span><div className="col" style={{ gap: 8 }}><div><b>Run your first strategy</b><div className="small muted">Describe it in plain English.</div></div><div><button className="btn sm" onClick={() => go("trade")}>Describe a strategy</button></div></div></div>
          </div>
        </div>
      )}

      <div className="dash-top">
        <div className="card hero-card">
          <div className="row between wrapr" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="eyebrow">Total portfolio value</div>
              <div className="bignum" style={{ marginTop: 8 }}><CountUp value={h.total} format={usd} /></div>
              <div className="small" style={{ marginTop: 8 }}>
                {h.history.length > 1 ? <><Delta v={change * 100} /> <span className="muted">since you started</span></> : <span className="muted">Your account</span>}
                <span className="muted"> · {h.demo ? "demo" : "on NEAR"}</span>
              </div>
            </div>
            <div className="row wrapr">
              <button className="btn primary" onClick={() => go("trade")}>New strategy</button>
              <button className="btn" onClick={() => go("wallet")}>Add funds</button>
            </div>
          </div>
          <AreaChart data={h.history} />
        </div>

        <div className="card">
          <div className="eyebrow">Where your money is</div>
          <div className="row wrapr" style={{ gap: 18, alignItems: "center" }}>
            <Donut slices={slices} center={usd(sliceTotal)} sub="allocated" />
            <div className="legend-col">
              {slices.length === 0 && <span className="muted small">Nothing yet. Add funds, then start a strategy.</span>}
              {slices.slice(0, 7).map((s, i) => (
                <div key={s.label} className="lg"><i style={{ background: PALETTE[i % PALETTE.length] }} /><span>{s.label}</span><b>{sliceTotal ? Math.round((s.value / sliceTotal) * 100) : 0}%</b></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Available cash" value={usd(h.free)} sub="in your Helm wallet" />
        <Kpi label="Invested" value={usd(h.deployed)} sub={`${running.length} agent${running.length === 1 ? "" : "s"} running`} />
        <Kpi label="Open P&L" value={signedUsd(unrealised)} tone={unrealised >= 0 ? "good" : "bad"} sub={invested ? <Delta v={(unrealised / invested) * 100} /> : "no open positions"} />
        <Kpi label="Realised P&L" value={signedUsd(realised)} tone={realised >= 0 ? "good" : "bad"} sub={`${h.strategies.filter((s) => s.exitValue != null).length} closed`} />
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="row between"><h3>Running strategies</h3><button className="btn ghost sm" onClick={() => go("strategies")}>View all</button></div>
          {running.length === 0 ? (
            <div className="empty-note">
              <span>No agents running yet. Describe a goal and Helm builds the basket, forecasts it and starts an agent to guard it.</span>
              <div className="chips">
                {["I have 10 USDC, give me the best returns", "$500, safe and steady, 6 months", "$1000 in tech stocks and gold, stop loss 8%"].map((x) => <button key={x} className="chip" onClick={() => onIdea(x)}>{x}</button>)}
              </div>
              <button className="btn primary" onClick={() => go("trade")}>New strategy</button>
            </div>
          ) : (
            <div className="list">
              {running.slice(0, 6).map((s) => {
                const v = portfolioValue(s, h.prices);
                const r = v / s.intent.capitalUsd - 1;
                return (
                  <button key={s.id} className="rowbtn" onClick={() => go("strategies")}>
                    <div><b>{s.name}</b><div className="small muted">{usd(s.intent.capitalUsd)} · {s.intent.horizonDays}d{s.intent.stopLoss != null ? ` · auto-sell at -${pct(s.intent.stopLoss, 0)}` : ""}</div></div>
                    <div style={{ textAlign: "right" }}><b>{usd(v)}</b><div className="small"><Delta v={r * 100} /></div></div>
                  </button>
                );
              })}
            </div>
          )}
          <div className="row small muted"><span className="dot" /> Agents check every price update and sell at your stop-loss.</div>
        </div>

        <div className="dash-side">
          <div className="card">
            <div className="row between"><h3>Watchlist</h3><button className="btn ghost sm" onClick={() => go("assets")}>All assets</button></div>
            {watch.length ? (
              <div className="list">
                {watch.map((r) => (
                  <div key={r.symbol} className="rowbtn static">
                    <div><b>{r.symbol}</b><div className="small muted">{ASSETS[r.symbol as keyof typeof ASSETS]?.name ?? r.symbol}</div></div>
                    <Spark data={r.spark} up={r.change24h >= 0} w={80} h={26} />
                    <div style={{ textAlign: "right" }}><b>${fmtPrice(r.price)}</b><div className="small"><Delta v={r.change24h} /></div></div>
                  </div>
                ))}
              </div>
            ) : <SkelRows n={4} label="Loading live prices" />}
            <Fresh at={at} />
          </div>

          <div className="card">
            <div className="row between"><h3>Market movers · 24h</h3><button className="btn ghost sm" onClick={() => go("market")}>Open market</button></div>
            <div className="movers">
              {[{ t: "Gainers", list: movers.up }, { t: "Losers", list: movers.down }].map((g) => (
                <div key={g.t}>
                  <div className="small muted" style={{ marginBottom: 6 }}>{g.t}</div>
                  {g.list.map((r) => (
                    <div key={r.symbol} className="mv"><b>{r.symbol}</b><span>${fmtPrice(r.price)}</span><Delta v={r.change24h} digits={1} /></div>
                  ))}
                  {!g.list.length && <div className="skel-rows">{[0, 1, 2, 3].map((i) => <Skel key={i} h={22} />)}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
