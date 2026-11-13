"use client";
import type { Strategy } from "@/lib/types";
import { Analysis } from "./Analysis";
import { BasketBuilder } from "./BasketBuilder";
import { Options } from "./Options";
import { Refine } from "./Strategies";
import { usd } from "@/lib/format";
import { Skel, Stage } from "./ui";
import type { Helm } from "./useHelm";

export type View = "overview" | "trade" | "strategies" | "wallet" | "market" | "assets";

const EXAMPLES = [
  "I have 10 USDC, give me the best returns",
  "$5k, safe and steady, I can wait 6 months",
  "$5k: 60% BTC, 30% ETH, 10% NEAR. 10% in 2 months, stop loss 10%",
  "$2k in tech stocks and gold, 8% in 3 months, stop loss 6%",
];

interface Props {
  h: Helm;
  prompt: string;
  setPrompt: (s: string) => void;
  pending: Strategy | null;
  setPending: (s: Strategy | null) => void;
  locked: boolean;
  go: (v: View) => void;
}

export function TradeView({ h, prompt, setPrompt, pending, setPending, locked, go }: Props) {
  async function run() {
    h.setError(undefined);
    try {
      setPending(await h.analyze(prompt));
    } catch (e) {
      h.setError(e instanceof Error ? e.message : String(e));
    }
  }
  const need = pending?.intent.capitalUsd ?? 0;
  const short = pending != null && h.free < need;
  const blocked = pending != null && (h.demo ? short : h.free < 1);

  return (
    <section className="view">
      <div className="view-head">
        <h1 className="display">Say what you want</h1>
        <p>Plain language in. One basket, a Monte Carlo forecast from real prices and a stop-loss agent out. Tradable here: crypto, tokenized US stocks, index funds, bonds and gold. The full list is in Markets, under Asset guide.</p>
      </div>

      <div className="grid2">
        <div className="col sticky">
          <BasketBuilder h={h} onBuilt={setPending} />
          <div className="card">
            <div className="eyebrow">Your brief</div>
            <div className="prompt">
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} aria-label="Describe your strategy"
                placeholder="I have $10k. 60% BTC, 30% ETH, 10% NEAR. I want 10% ROI in 2 months with a 10% stop loss." />
            </div>
            <div className="row between wrapr">
              <span className="muted small">Not sure what to pick? Just say your amount and goal, and the AI recommends a mix.</span>
              <button className="btn primary" disabled={!prompt.trim() || h.busy.analyze || !h.market} onClick={run}>{h.busy.analyze ? "Analysing…" : "Analyse"}</button>
            </div>
            <Stage text={h.stage.analyze} />
            {h.marketError && <p className="bad small">Market data failed: {h.marketError}</p>}
            {!h.market && !h.marketError && <div className="col" style={{ gap: 6 }} role="status" aria-label="Loading market history"><Skel w="60%" /><Skel w="40%" /></div>}
            {h.error && <p className="bad small" role="alert">{h.error}</p>}
            <div className="examples">
              <span className="fine">Try one</span>
              {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => setPrompt(e)}>{e}</button>)}
            </div>
          </div>

          {h.demo && (
            <div className="card">
              <div className="eyebrow">Market controls</div>
              <p className="muted small" style={{ margin: 0 }}>Replay history to watch every stop-loss agent react.</p>
              <div className="row wrapr">
                <button className="btn sm" onClick={h.advanceDay}>Advance 1 day</button>
                <button className="btn sm" onClick={() => h.shock(-0.05)}>-5%</button>
                <button className="btn sm danger" onClick={() => h.shock(-0.15)}>Crash -15%</button>
                <button className="btn sm ghost" onClick={() => { h.resetDemo(); setPending(null); }}>Reset</button>
              </div>
            </div>
          )}
        </div>

        <div className="col">
          {pending ? (
            <div className="card">
              {pending.events[0]?.message.includes("rule-based") && <div className="verdict">The AI advisor is unavailable right now (its free daily limit may be used up), so a basic parser read your request. Anything you spelled out is respected; the rest is a starting guess.</div>}
              <Options s={pending} h={h} onPick={setPending} auto={!!pending.intent.advised} />
              <Analysis s={pending} />
              <Refine s={pending} h={h} onChange={setPending} />
              <div className="row actions wrapr" style={{ paddingTop: 8 }}>
                <button className="btn primary big" disabled={locked || blocked || h.busy[pending.id]}
                  onClick={async () => { const p = pending; setPending(null); go("strategies"); await h.execute(p); }}>
                  {h.busy[pending.id] ? "Starting…" : `Invest ${usd(!h.demo && h.free >= 1 ? Math.min(need, h.free) : need)}`}
                </button>
                <button className="btn big" disabled={locked} onClick={() => { h.saveDraft(pending); setPending(null); go("strategies"); }}>Save draft</button>
                <button className="btn ghost big" onClick={() => setPending(null)}>Delete</button>
              </div>
              <div className="reassure">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 13l4 4L19 7" /></svg>
                <span>No lock-up. Close any time and the money returns to your Helm wallet.</span>
              </div>
              {locked ? <span className="fine">Connect your NEAR wallet to invest or save.</span> : (
                <p className="fine">
                  Investing draws <b>{usd(need)}</b> from your wallet ({usd(h.free)} free).{" "}
                  {short && (h.demo
                    ? <span className="bad">Not enough in the wallet. <button className="chip" onClick={() => go("wallet")}>Deposit first</button></span>
                    : <span className="warn">It will be sized to what's free.{h.free < 1 && <> <button className="chip" onClick={() => go("wallet")}>Add funds</button></>}</span>)}
                </p>
              )}
            </div>
          ) : (
            <div className="card empty">
              <span className="eyebrow">Waiting for your brief</span>
              <h2 className="display">Your basket appears here</h2>
              <p className="muted" style={{ maxWidth: 440, margin: 0 }}>Helm turns it into one tradable asset, simulates 5,000 futures from two years of real prices, and lets you execute, save a draft, or discard it.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
