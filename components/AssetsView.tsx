"use client";
import { useEffect, useMemo, useState } from "react";
import { ASSETS, KIND_LABEL, SYMBOLS, type AssetKind } from "@/lib/types";
import * as tp from "@/lib/tidepool";
import { profiles, riskLabel } from "@/lib/universe";
import { NetTag } from "./Analysis";
import { useBasket } from "./basket";
import { Skel } from "./ui";

const NETWORKS: Record<string, string> = {
  near: "NEAR", base: "Base", arb: "Arbitrum", eth: "Ethereum", bsc: "BNB Chain", aurora: "Aurora",
  sol: "Solana", stellar: "Stellar", sui: "Sui", xrp: "XRP Ledger", btc: "Bitcoin", hypercore: "Hyperliquid",
};
const ORDER: AssetKind[] = ["stock", "etf", "bond", "commodity", "crypto"];
const pct = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(v * 100).toFixed(0)}%`;
const price = (v?: number) => (v == null ? "-" : v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(2) : v.toPrecision(3));

/** Everything Helm can trade on NEAR, by type, plus the other tokens available there. */
export function AssetsView({ onUse }: { onUse: (sym: string) => void }) {
  const basket = useBasket();
  const [tokens, setTokens] = useState<tp.TokenInfo[]>([]);
  const [err, setErr] = useState<string>();
  const [kind, setKind] = useState<AssetKind | "all">("all");
  useEffect(() => {
    tp.tokens().then((m) => setTokens([...m.values()])).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  const prof = useMemo(() => Object.fromEntries(profiles().map((p) => [p.symbol, p])), []);
  const live = useMemo(() => new Map(tokens.map((t) => [t.assetId, t])), [tokens]);
  const mine = new Set<string>(SYMBOLS.map((s) => ASSETS[s].tp));
  const others = tokens.filter((t) => !mine.has(t.assetId) && !/^(USDC|USDT)$/.test(t.symbol));
  const stable = tokens.filter((t) => /^(USDC|USDT)$/.test(t.symbol));
  const byChain = useMemo(() => {
    const m = new Map<string, tp.TokenInfo[]>();
    for (const t of others) m.set(t.blockchain, [...(m.get(t.blockchain) ?? []), t]);
    return [...m.entries()];
  }, [others]);

  return (
    <section className="view">
      <div className="view-head">
        <h1 className="display">What you can invest in</h1>
        <p>Crypto, tokenized US stocks, index funds, bonds and gold, all tradable by Helm's agents on NEAR. Prices are live; the past-year figures are real history.</p>
      </div>

      <div className="row wrapr" style={{ marginBottom: 24 }}>
        {(["all", ...ORDER] as const).map((k) => (
          <button key={k} className={`chip ${kind === k ? "sel" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === "all" ? `All (${SYMBOLS.length})` : `${KIND_LABEL[k]} (${SYMBOLS.filter((s) => ASSETS[s].kind === k).length})`}
          </button>
        ))}
      </div>
      {err && <p className="bad small">Live prices unavailable: {err}</p>}

      {ORDER.filter((k) => kind === "all" || kind === k).map((k) => (
        <div className="sec" key={k} style={{ marginTop: 32 }}>
          <div className="sec-head"><h2 className="display" style={{ fontSize: 30 }}>{KIND_LABEL[k]}</h2><span className="count">{SYMBOLS.filter((s) => ASSETS[s].kind === k).length}</span></div>
          <div className="strats" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))" }}>
            {SYMBOLS.filter((s) => ASSETS[s].kind === k).map((s) => {
              const a = ASSETS[s], p = prof[s], t = live.get(a.tp);
              return (
                <article className="strat" key={s} style={{ padding: "18px 18px 16px 22px" }}>
                  <div className="strat-top">
                    <div><div className="strat-name" style={{ fontSize: 22 }}>{a.name}</div><div className="strat-meta">{s}<NetTag net={a.network} /></div></div>
                    <div className="mono" style={{ textAlign: "right" }}>${price(t?.price)}<div className="fine">Live price</div></div>
                  </div>
                  <p className="small muted" style={{ margin: 0 }}>{a.blurb}</p>
                  <div className="row between small">
                    <span>Last 12 months <b className={`mono ${p.ret1y >= 0 ? "good" : "bad"}`}>{pct(p.ret1y)}</b></span>
                    <span>Risk <b>{riskLabel(p.vol)}</b></span>
                  </div>
                  <div className="row wrapr">
                    <button className={`btn sm ${basket.has(s) ? "" : "primary"}`} onClick={() => basket.toggle(s)} aria-pressed={basket.has(s)}>{basket.has(s) ? "✓ In basket" : "+ Add to basket"}</button>
                    <button className="btn sm ghost" onClick={() => onUse(s)}>Use alone</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}

      <div className="sec">
        <div className="sec-head"><h2 className="display" style={{ fontSize: 30 }}>Cash</h2></div>
        <p className="small muted" style={{ margin: 0 }}>
          Strategies hold unused money as <b>USDC</b> on NEAR. You can add funds from other networks in the Wallet section.</p>
      </div>

      <div className="sec">
        <div className="sec-head"><h2 className="display" style={{ fontSize: 30 }}>Also on NEAR</h2><span className="count">{others.length}</span></div>
        <p className="small muted">These tokens are available on NEAR but Helm does not trade them yet (no price history loaded).</p>
        <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 16 }}>
          <table>
            <thead><tr><th>Token</th><th>Network</th><th>Price</th></tr></thead>
            <tbody>
              {byChain.flatMap(([chain, list]) => list.map((t) => (
                <tr key={t.assetId}><td><b>{t.symbol}</b></td><td style={{ textAlign: "left" }}>{NETWORKS[chain] ?? chain}</td><td className="mono">${price(t.price)}</td></tr>
              )))}
              {!others.length && !err && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={3}><Skel h={16} /></td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <p className="fine" style={{ marginTop: 24 }}>Stock and fund tokens follow US market hours for price discovery, so prices can sit still overnight and on weekends.</p>
    </section>
  );
}
