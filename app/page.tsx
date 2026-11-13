import Link from "next/link";
import backtest from "../data/backtest.json";
import snapshot from "../data/snapshot.json";
import { FanChart } from "@/components/FanChart";
import { HeroGraphic, LiveTicker, Reveal } from "@/components/LandingBits";
import { Logo } from "@/components/Logo";
import { ThemeControls } from "@/components/ThemeControls";
import { project } from "@/lib/montecarlo";
import { SYMBOLS, type Intent, type MarketData } from "@/lib/types";

const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;

const FEATURES = [
  { icon: "M4 6h16M4 12h10M4 18h6", t: "Say it in plain English", d: "\"$500, safe and steady, 6 months\" or \"60% BTC, 30% ETH, 10% NEAR, stop at 10%\". Helm turns it into one basket." },
  { icon: "M3 17l6-6 4 4 8-8", t: "Forecasts from real prices", d: "5,000 simulated futures built from two years of real daily prices, never from an AI's guess." },
  { icon: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z", t: "A stop-loss agent per strategy", d: "Each strategy is its own agent with its own account. It sells on your stop, even when you are away from the wallet." },
  { icon: "M4 20V10m6 10V4m6 16v-8m6 8V8", t: "Crypto, stocks, bonds and gold", d: "18 assets on NEAR: BTC, ETH, NEAR, Apple, Nvidia, the S&P 500, Treasuries, gold and more." },
  { icon: "M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2", t: "One wallet, many strategies", d: "Fund one Helm wallet from your NEAR wallet or another network. Agents draw what they need and return it when they exit." },
  { icon: "M5 13l4 4L19 7", t: "Honest about its limits", d: `We replayed the past: real results landed inside the forecast range ${Math.round(backtest.summary.neutral.inside90 * 100)}% of the time (aim: 90%). It maps risk; it does not promise returns.` },
];

export default function Home() {
  const intent: Intent = { capitalUsd: 10_000, weights: { BTC: 0.4, SPY: 0.3, GLD: 0.2, AGG: 0.1 }, targetRoi: 0.05, horizonDays: 60, stopLoss: 0.1, prompt: "" };
  const p = project(snapshot as unknown as MarketData, intent, { paths: 3000, seed: 9 });
  const end = intent.horizonDays;

  return (
    <>
      <header className="head">
        <div className="wrap">
          <Logo />
          <span className="grow" />
          <ThemeControls compact />
          <Link href="/demo" className="btn sm ghost">Try the demo</Link>
          <Link href="/live" className="btn sm primary">Open the app</Link>
        </div>
      </header>
      <LiveTicker />
      <main className="wrap" style={{ position: "relative", zIndex: 1 }}>
        <section className="hero2">
          <HeroGraphic />
          <div className="hero-copy">
            <span className="pill live">NEAR HACKATHON · DeFi · AI agents</span>
            <h1 className="display">Invest by saying it. <em>Helm</em> manages the risk.</h1>
            <p className="lead">Describe your goal in plain English. Helm builds the portfolio, shows what could happen to your money before you commit, and a stop-loss agent protects it around the clock.</p>
            <div className="cta">
              <Link href="/demo" className="btn primary big">Try the demo</Link>
              <Link href="/live" className="btn big">Open the app →</Link>
            </div>
            <div className="trust">
              <span>Built on <b>NEAR</b></span><span>Trades via <b>NEAR Intents</b></span><span>Wallet <b>Meteor</b></span><span>Prices <b>Binance · Yahoo</b></span>
            </div>
          </div>

          <div className="card preview" aria-label="Example forecast">
            <div className="row between wrapr">
              <div>
                <div className="eyebrow">Example · real data</div>
                <div className="strat-name" style={{ marginTop: 6 }}>40% BTC · 30% S&amp;P 500 · 20% gold · 10% bonds</div>
                <div className="strat-meta">$10,000 · 60 days · goal +5% · auto-sell at -10%</div>
              </div>
            </div>
            <FanChart p={p} intent={intent} />
            <div className="outcomes">
              <div className="oc bad"><span className="t">Rough patch</span><span className="v">{usd(p.fan.p5[end])}</span></div>
              <div className="oc mid"><span className="t">Typical</span><span className="v">{usd(p.fan.p50[end])}</span></div>
              <div className="oc good"><span className="t">Good run</span><span className="v">{usd(p.fan.p95[end])}</span></div>
            </div>
            <p className="fine">{Math.round(p.probTarget * 100)} in 100 simulated futures reach the goal. A forecast of how wide outcomes can be, not a promise.</p>
          </div>
        </section>

        <Reveal><section className="statband">
          <div><b>{SYMBOLS.length}</b><span>tradable assets</span></div>
          <div><b>5,000</b><span>simulated futures per strategy</span></div>
          <div><b>{(snapshot as unknown as MarketData).dates.length / 365 > 1 ? ((snapshot as unknown as MarketData).dates.length / 365).toFixed(1) : "2"} yrs</b><span>of real daily prices</span></div>
          <div><b>1 agent</b><span>per strategy, own account</span></div>
        </section></Reveal>

        <section className="steps3">
          {[["1", "Describe", "Type what you want, or just your amount and goal."], ["2", "Review", "See the best, typical and worst case, and compare safer or bolder mixes."], ["3", "Let it run", "Execute, and your agent guards the position and sells at your stop."]].map(([n, t, d]) => (
            <Reveal key={n} delay={Number(n) * 0.1}><div><span className="stepn">{n}</span><h3>{t}</h3><p>{d}</p></div></Reveal>
          ))}
        </section>

        <section className="features">
          {FEATURES.map((f, k) => (
            <Reveal key={f.t} delay={(k % 3) * 0.1}><div className="card feat">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={f.icon} /></svg>
              <h3>{f.t}</h3>
              <p className="muted small" style={{ margin: 0 }}>{f.d}</p>
            </div></Reveal>
          ))}
        </section>

        <Reveal><section className="finalcta card">
          <h2 className="display" style={{ fontSize: "clamp(30px, 4vw, 48px)" }}>See your first forecast in a minute.</h2>
          <div className="cta" style={{ marginTop: 0 }}>
            <Link href="/demo" className="btn primary big">Try the demo</Link>
            <Link href="/live" className="btn big">Open the app</Link>
          </div>
        </section></Reveal>

        <footer className="foot">Helm · AI-managed portfolios on NEAR · Forecasts are Monte Carlo simulations on real prices, not promises. Not financial advice.</footer>
      </main>
    </>
  );
}
