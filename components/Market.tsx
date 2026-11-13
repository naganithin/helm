"use client";
import { useEffect, useMemo, useState } from "react";
import { ASSETS, type Symbol } from "@/lib/types";
import { useBasket } from "./basket";
import { Delta, Skel } from "./ui";

export interface MarketRow {
  symbol: string; price: number; change24h: number; volume: number; high: number; low: number; spark: number[]; tradable: boolean;
}

/** Live top markets from Binance (public mirror), refreshed every 20 s. */
export function useMarkets() {
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [error, setError] = useState<string>();
  const [at, setAt] = useState<number>();
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/markets")
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          if (live) { setRows(j.rows); setAt(j.at); setError(undefined); }
        })
        .catch((e) => live && setError(e.message));
    load();
    const id = setInterval(load, 20_000);
    return () => { live = false; clearInterval(id); };
  }, []);
  return { rows, error, at };
}

export const fmtPrice = (v: number) =>
  v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(4) : v.toPrecision(3);
const fmtVol = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`);

export function Spark({ data, up, w = 110, h = 30 }: { data: number[]; up: boolean; w?: number; h?: number }) {
  if (data.length < 2) return <span className="dim">-</span>;
  const lo = Math.min(...data), hi = Math.max(...data);
  const d = data.map((v, i) => `${i ? "L" : "M"}${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`).join("");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--good)" : "var(--bad)"} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function Ticker({ rows }: { rows: MarketRow[] }) {
  const items = rows.slice(0, 24);
  if (!items.length) return <div className="ticker" aria-label="Loading live prices"><div className="ticker-track">{[0, 1, 2, 3, 4, 5].map((i) => <Skel key={i} w={120} h={12} />)}</div></div>;
  const strip = items.map((r) => (
    <span className="ticker-item" key={r.symbol}>
      <b>{r.symbol}</b>${fmtPrice(r.price)}
      <Delta v={r.change24h} />
    </span>
  ));
  return <div className="ticker" aria-label="Live prices"><div className="ticker-track">{strip}{strip}</div></div>;
}

type Range = "1D" | "7D" | "30D" | "1Y";

function BigChart({ symbol, onBuild, tradable }: { symbol: string; onBuild?: (s: string) => void; tradable: boolean }) {
  const [range, setRange] = useState<Range>("7D");
  const [pts, setPts] = useState<[number, number][]>([]);
  const [err, setErr] = useState<string>();
  const [hover, setHover] = useState<number | null>(null);
  const basket = useBasket();
  useEffect(() => {
    let live = true;
    setErr(undefined);
    fetch(`/api/chart?symbol=${symbol}&range=${range}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        if (live) setPts(j.points);
      })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [symbol, range]);

  const W = 480, H = 240, P = { l: 8, r: 8, t: 12, b: 20 };
  const vals = pts.map((p) => p[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i: number) => P.l + (i / Math.max(1, pts.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const first = vals[0], last = vals.at(-1) ?? 0;
  const up = last >= first;
  const shown = hover != null ? pts[hover] : pts.at(-1);
  const change = first ? ((last / first - 1) * 100) : 0;

  return (
    <div className="card sticky">
      <div className="row between">
        <div>
          <div className="eyebrow">{symbol} / USDT</div>
          <div className="bignum" style={{ marginTop: 8 }}>{shown ? `$${fmtPrice(shown[1])}` : <Skel w={180} h={44} />}</div>
          <div className="small" style={{ marginTop: 6 }}>{pts.length > 1 ? <Delta v={change} /> : null} <span className="muted">over {range}{shown && hover != null ? ` · ${new Date(shown[0]).toLocaleString()}` : ""}</span></div>
        </div>
        <div className="ranges">{(["1D", "7D", "30D", "1Y"] as Range[]).map((r) => <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>)}</div>
      </div>
      {err ? <p className="bad small">Chart unavailable: {err}</p> : pts.length > 1 ? (
        <svg key={`${symbol}-${range}`} viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`${symbol} price chart`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - b.left) / b.width * W - P.l) / (W - P.l - P.r) * (pts.length - 1))))); }}>
          <defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style={{ stopColor: up ? "var(--good)" : "var(--bad)", stopOpacity: 0.26 }} /><stop offset="1" style={{ stopColor: up ? "var(--good)" : "var(--bad)", stopOpacity: 0 }} /></linearGradient></defs>
          <path className="areafill" d={`${line}L${x(pts.length - 1)},${H - P.b}L${x(0)},${H - P.b}Z`} fill="url(#fill)" />
          <path className="draw" pathLength={1} d={line} fill="none" stroke={up ? "var(--good)" : "var(--bad)"} strokeWidth="2" strokeLinejoin="round" />
          <text x={P.l} y={H - 5} className="axis">${fmtPrice(lo)}</text>
          <text x={W - P.r} y={H - 5} textAnchor="end" className="axis">${fmtPrice(hi)}</text>
          {hover != null && <><line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="var(--line2)" /><circle cx={x(hover)} cy={y(pts[hover][1])} r="4" fill="var(--ink)" /></>}
        </svg>
      ) : <Skel h={240} r={12} />}
      {tradable ? (
        <div className="row between wrapr">
          <span className="small good">Tradable by Helm agents on NEAR</span>
          <div className="row wrapr">
            {symbol in ASSETS && <button className={`btn sm ${basket.has(symbol as Symbol) ? "" : "primary"}`} onClick={() => basket.toggle(symbol as Symbol)}>{basket.has(symbol as Symbol) ? "✓ In basket" : "+ Add to basket"}</button>}
            {onBuild && <button className="btn sm ghost" onClick={() => onBuild(symbol)}>Use alone</button>}
          </div>
        </div>
      ) : <p className="fine">Market data only. Helm agents can't trade this asset yet.</p>}
    </div>
  );
}

export function MarketView({ rows, error, onBuild }: { rows: MarketRow[]; error?: string; onBuild: (s: string) => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"volume" | "change24h" | "price">("volume");
  const [sel, setSel] = useState("BTC");
  const list = useMemo(
    () => rows.filter((r) => r.symbol.includes(q.toUpperCase())).sort((a, b) => (b[sort] as number) - (a[sort] as number)),
    [rows, q, sort],
  );
  const cur = rows.find((r) => r.symbol === sel);
  return (
    <section className="view">
      <div className="view-head">
        <h1 className="display">Every market, live</h1>
        <p>Top {rows.length || 100} markets by 24h volume, refreshed every 20 seconds. Tap one for its chart. Assets tagged <span className="badge" style={{ margin: 0 }}>Tradable</span> are the ones Helm's agents can buy on NEAR.</p>
      </div>
      {error && <p className="bad small">Live prices unavailable: {error}</p>}
      <div className="row" style={{ marginBottom: 16, maxWidth: 420 }}>
        <input placeholder="Search a coin (BTC, SOL...)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
      </div>
      <div className="mk">
        <div className="mk-table">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th onClick={() => setSort("price")}>Price {sort === "price" && "↓"}</th>
                <th onClick={() => setSort("change24h")}>24h {sort === "change24h" && "↓"}</th>
                <th onClick={() => setSort("volume")}>Volume {sort === "volume" && "↓"}</th>
                <th>7 days</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.symbol} className={`click ${r.symbol === sel ? "sel" : ""}`} onClick={() => setSel(r.symbol)}>
                  <td>{r.symbol}{r.tradable && <span className="badge">Tradable</span>}</td>
                  <td>${fmtPrice(r.price)}</td>
                  <td><Delta v={r.change24h} /></td>
                  <td className="muted">${fmtVol(r.volume)}</td>
                  <td><Spark data={r.spark} up={(r.spark.at(-1) ?? 0) >= (r.spark[0] ?? 0)} /></td>
                </tr>
              ))}
              {!list.length && (rows.length
                ? <tr><td colSpan={5} className="muted">No match</td></tr>
                : Array.from({ length: 8 }, (_, i) => <tr key={i} aria-hidden><td colSpan={5}><Skel h={20} /></td></tr>))}
            </tbody>
          </table>
        </div>
        <BigChart symbol={sel} tradable={!!cur?.tradable} onBuild={onBuild} />
      </div>
    </section>
  );
}
