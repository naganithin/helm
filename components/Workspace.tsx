"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usd } from "@/lib/format";
import type { Strategy } from "@/lib/types";
import { AssetsView } from "./AssetsView";
import { BasketButton } from "./BasketButton";
import { Logo } from "./Logo";
import { MarketView, Ticker, useMarkets } from "./Market";
import { deriveWalletSeed, useNearWallet } from "./nearWallet";
import { Overview } from "./Overview";
import { StrategiesView } from "./Strategies";
import { ThemeControls } from "./ThemeControls";
import { Toaster } from "./toast";
import { TradeView, type View } from "./Trade";
import { DEMO_PROMPT, useHelm, type Mode } from "./useHelm";
import { Wallet } from "./Wallet";
import { WalletView } from "./WalletView";

type Section = Exclude<View, "assets">;
const ICON: Record<Section, string> = {
  overview: "M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z",
  trade: "M4 17l5-5 4 4 7-8M15 8h5v5",
  strategies: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  wallet: "M3 7h15a3 3 0 0 1 3 3v8a1 1 0 0 1-1 1H3zM3 7V5.5A1.5 1.5 0 0 1 4.5 4H16M16 13h2",
  market: "M3 20h18M6 16v-5M11 16V6M16 16v-8M21 16V9",
};
// Five destinations: Markets holds both live prices and the asset guide (two tabs).
const NAV: { id: Section; label: string; hint: string }[] = [
  { id: "overview", label: "Overview", hint: "Your portfolio at a glance" },
  { id: "trade", label: "Trade", hint: "Describe a strategy" },
  { id: "strategies", label: "Strategies", hint: "Running, drafts and closed" },
  { id: "wallet", label: "Wallet", hint: "Balance and funding" },
  { id: "market", label: "Markets", hint: "Live prices and what you can invest in" },
];
const sectionOf = (v: View): Section => (v === "assets" ? "market" : v);
const VIEWS: View[] = ["overview", "trade", "strategies", "wallet", "market", "assets"];
const TICKER_ON: View[] = ["overview", "market", "assets"]; // ambient prices only where browsing, not during tasks

export function Workspace({ mode }: { mode: Mode }) {
  const w = useNearWallet();
  const account = w.accountId;
  const h = useHelm(mode, account, deriveWalletSeed);
  const markets = useMarkets();
  const [view, setView] = useState<View>(mode === "demo" ? "trade" : "overview");
  const [prompt, setPrompt] = useState(mode === "demo" ? DEMO_PROMPT : "");
  const [pending, setPending] = useState<Strategy | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const locked = !h.demo && !account;

  const go = useCallback((v: View) => {
    setView(v);
    try { history.replaceState(null, "", `#${v}`); } catch {}
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const v = location.hash.slice(1) as View;
    if (VIEWS.includes(v)) setView(v);
  }, []);
  // number keys 1-5 switch sections (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
      const n = Number(e.key);
      if (n >= 1 && n <= NAV.length) go(NAV[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // demo opens with the headline strategy already analysed
  const { analyze, market, hydrated, strategies } = h;
  useEffect(() => {
    if (mode === "demo" && market && hydrated && !pending && strategies.length === 0) {
      analyze(DEMO_PROMPT).then(setPending).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, market, hydrated]);

  const running = h.strategies.filter((s) => s.status === "active").length;
  const idea = (text: string) => { setPrompt(text); go("trade"); };
  const buildWith = (sym: string) => idea(`I have $1,000. 100% ${sym}. 10% ROI in 30 days, stop loss 8%`);
  const broke = !h.demo && !!account && !!h.vault && h.vaultUsdc != null && h.free < 1;
  const section = sectionOf(view);
  const current = NAV.find((n) => n.id === section)!;

  const gate = (
    <section className="view">
      <div className="card gate">
        <span className="eyebrow">Live</span>
        <h2 className="display" style={{ fontSize: 32 }}>Connect your NEAR wallet</h2>
        <p className="muted" style={{ maxWidth: 520, margin: 0 }}>Your Helm wallet is tied to your NEAR account, so you get the same wallet on every device. Markets work without connecting.</p>
        <div><button className="btn primary big" disabled={!w.ready} onClick={w.connect}>{w.ready ? "Connect wallet" : "Loading…"}</button></div>
      </div>
    </section>
  );

  return (
    <div className="app">
      <aside className="side" aria-label="Main menu">
        <Logo />
        <div className="snav-wrap">
          <div className="side-label" style={{ marginBottom: 8 }}>{h.demo ? "Demo" : "Live"}</div>
          <nav className="snav">
            {NAV.map((n, i) => (
              <button key={n.id} className={section === n.id ? "on" : ""} onClick={() => go(n.id)} aria-current={section === n.id ? "page" : undefined} title={`${n.hint} (press ${i + 1})`}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON[n.id]} /></svg>
                <span>{n.label}</span>
                {n.id === "strategies" && running > 0 && <span className="n" aria-label={`${running} running`}>{running}</span>}
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </nav>
        </div>
        <div className="side-foot">
          <div className="side-label">Palette</div>
          <ThemeControls />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumb">{current.label} <span>· {current.hint}</span></div>
          <span className="grow" />
          {!locked && <span className="topbal">Available<b>{usd(h.free)}</b></span>}
          <span className={`pill ${h.demo ? "demo" : "live"}`}>{h.demo ? "Demo" : "Live"}</span>
          {h.demo ? <Link href="/live" className="btn sm primary">Go live</Link> : <Wallet w={w} />}
        </header>
        {w.notice && !h.demo && (
          <div className="banner info" role="status"><div className="wrap"><span><b>Wallet switched.</b> {w.notice}</span><span className="grow" /><button className="btn ghost sm" onClick={w.clearNotice}>Dismiss</button></div></div>
        )}
        {broke && !dismissed && (
          <div className="banner" role="alert">
            <div className="wrap">
              <span><b>Your Helm wallet is empty.</b> You can look around, but you can&apos;t run a strategy until you add funds.</span>
              <span className="grow" />
              <button className="btn sm primary" onClick={() => go("wallet")}>Add funds</button>
              <button className="btn ghost sm" onClick={() => setDismissed(true)}>Continue without funds</button>
            </div>
          </div>
        )}
        {TICKER_ON.includes(view) && <Ticker rows={markets.rows} />}
        <main className="wrap">
          {section === "market" && (
            <div className="subnav">
              <div className="seg" role="tablist" aria-label="Markets">
                <button role="tab" aria-selected={view === "market"} className={view === "market" ? "on" : ""} onClick={() => go("market")}>Live prices</button>
                <button role="tab" aria-selected={view === "assets"} className={view === "assets" ? "on" : ""} onClick={() => go("assets")}>Asset guide</button>
              </div>
            </div>
          )}
          {view === "assets" && <AssetsView onUse={buildWith} />}
          {view === "market" && <MarketView rows={markets.rows} error={markets.error} onBuild={buildWith} />}
          {section !== "market" && locked && gate}
          {view === "overview" && !locked && <Overview h={h} rows={markets.rows} at={markets.at} go={go} onIdea={idea} />}
          {view === "trade" && !locked && <TradeView h={h} prompt={prompt} setPrompt={setPrompt} pending={pending} setPending={setPending} locked={locked} go={go} />}
          {view === "strategies" && !locked && <StrategiesView h={h} onTrade={() => go("trade")} />}
          {view === "wallet" && !locked && <WalletView h={h} w={w} />}
          <footer className="foot">Helm · AI-managed portfolios on NEAR · Forecasts are Monte Carlo simulations on real prices, not promises. Not financial advice.</footer>
        </main>
      </div>
      <BasketButton onBuild={() => go("trade")} />
      <Toaster />
    </div>
  );
}
