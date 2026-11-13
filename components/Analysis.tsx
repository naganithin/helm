import backtest from "../data/backtest.json";
import { assetInfo, KIND_LABEL, type Strategy } from "@/lib/types";
import { riskLabel } from "@/lib/universe";
import { CountUp } from "./CountUp";
import { FanChart } from "./FanChart";
import { usd } from "@/lib/format";

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const signed = (v: number, d = 0) => `${v >= 0 ? "+" : "-"}${pct(Math.abs(v), d)}`;

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "good" | "bad"; hint: string }) {
  return (
    <div className="stat">
      <div className={`stat-v ${tone ?? ""}`}>{value}</div>
      <div className="stat-l">{label}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}

export const NetTag = ({ net }: { net: string }) => <span className={`net ${net.startsWith("BSC") ? "bsc" : "near"}`}>{net}</span>;

/** One honest sentence about whether the goal is realistic, computed from the simulation only. */
function verdict(s: Strategy): { tone: "good" | "bad" | ""; text: string } {
  const { projection: p, intent: i } = s;
  const goal = `+${pct(i.targetRoi)} in ${i.horizonDays} day${i.horizonDays === 1 ? "" : "s"}`;
  const n = Math.round(p.probTarget * 100);
  if (p.probTarget < 0.1) return { tone: "bad", text: `Very unlikely. Only ${n} in 100 simulated futures reach ${goal}. A smaller goal, more time or a different mix would be more realistic.` };
  if (p.probTarget < 0.4) return { tone: "", text: `A stretch. ${n} in 100 simulated futures reach ${goal}.` };
  return { tone: "good", text: `Reasonable. ${n} in 100 simulated futures reach ${goal}.` };
}

/** How the forecast was made and how well that method did when replayed on the past. */
export function Accuracy({ s }: { s: Strategy }) {
  const p = s.projection;
  const b = backtest.summary.neutral;
  const years = (p.historyDays / 365).toFixed(1);
  return (
    <details className="pro">
      <summary>How reliable is this forecast?</summary>
      <div className="col" style={{ paddingBottom: 14 }}>
        <div className="acc-grid">
          <div className="stat"><div className="stat-v">{years} yrs</div><div className="stat-l">of real daily prices used</div><div className="hint">{p.historyDays.toLocaleString()} days, {p.historyFrom} to {p.historyTo}</div></div>
          <div className="stat"><div className="stat-v">{p.paths.toLocaleString()}</div><div className="stat-l">simulated futures</div><div className="hint">each built by re-playing real past days in a random order</div></div>
          <div className="stat"><div className="stat-v">{pct(b.inside90)}</div><div className="stat-l">of real outcomes landed in the range</div><div className="hint">we replayed {b.n} past start dates; the range is meant to catch 90%</div></div>
          <div className="stat"><div className="stat-v">{pct(b.below5)}</div><div className="stat-l">did worse than the rough patch</div><div className="hint">meant to be about 5%</div></div>
        </div>
        <ul className="plain">
          <li><b>What it is:</b> a map of how wide the range of outcomes could be, not a prediction of what will happen. It does not know about news, and it does not assume prices go up or down: the past trend is removed so only the typical size of swings is used.</li>
          <li><b>How we checked:</b> at {b.n} past dates the model saw only the data before that date, forecast the next 30 or 60 days, and we compared with what really happened. Real results fell inside the range {pct(b.inside90)} of the time (target 90%) and half-range {pct(b.inside50)} (target 50%). The range is slightly cautious, which is the safe direction to be wrong.</li>
          <li><b>Limits:</b> the test covers about two years, one kind of market, and neighbouring start dates overlap, so treat it as a sanity check, not a guarantee. A crash worse than anything in those two years is not in the model. Stocks and funds do not move on weekends, so those days count as flat.</li>
        </ul>
      </div>
    </details>
  );
}

export function Analysis({ s }: { s: Strategy }) {
  const { projection: p, intent: i } = s;
  const v = verdict(s);
  const end = i.horizonDays;
  const good = p.fan.p95[end], typ = p.fan.p50[end], bad = p.fan.p5[end];
  const chance = Math.round(p.probTarget * 100);
  const level = ["Very low", "Low", "Medium", "High", "Very high"].indexOf(riskLabel(p.portfolioVol));
  const goal = i.capitalUsd * (1 + i.targetRoi);

  return (
    <div className="analysis">
      <div className="basket">
        <div>
          <div className="eyebrow">Your basket, as one asset</div>
          <h3>{s.name}</h3>
        </div>
        <div className="muted small mono">
          {usd(i.capitalUsd)} · {i.horizonDays} days · goal +{pct(i.targetRoi)}{i.stopLoss != null ? ` · auto-sell at -${pct(i.stopLoss)}` : " · no auto-sell"}
        </div>
      </div>

      {i.rationale && (
        <div className="aibox">
          <span className="eyebrow">Why this mix</span>
          <span>{i.rationale}</span>
        </div>
      )}

      <h4>What could happen to your {usd(i.capitalUsd)} in {end} day{end === 1 ? "" : "s"}</h4>
      <div className="outcomes">
        <div className="oc bad"><span className="t">Rough patch</span><span className="v">{usd(bad)}</span><span className="d">{signed(bad / i.capitalUsd - 1)} · about 1 time in 20 you do worse than this</span></div>
        <div className="oc mid"><span className="t">Typical</span><span className="v">{usd(typ)}</span><span className="d">{signed(typ / i.capitalUsd - 1)} · the middle outcome</span></div>
        <div className="oc good"><span className="t">Good run</span><span className="v">{usd(good)}</span><span className="d">{signed(good / i.capitalUsd - 1)} · about 1 time in 20 you do better</span></div>
      </div>

      <FanChart p={p} intent={i} />
      <p className="fine">Each line is one kind of future. The shaded area holds 9 out of 10 simulated futures; the brighter core holds half of them.</p>

      <div className="chance">
        <div>
          <div className="eyebrow">Chance of reaching your goal ({usd(goal)})</div>
          <div className="n" style={{ color: chance >= 50 ? "var(--good)" : chance >= 20 ? "var(--warn)" : "var(--bad)" }}><CountUp value={chance} format={(v) => String(Math.round(v))} /> in 100</div>
        </div>
        <div className="waffle" aria-label={`${chance} out of 100 simulated futures reach the goal`}>
          {Array.from({ length: 100 }, (_, k) => <i key={k} className={k < chance ? "on" : ""} style={{ ["--i" as string]: k }} />)}
        </div>
      </div>
      <h4>What each goal would cost</h4>
      <div className="ladder">
        {(p.ladder ?? []).map((g) => (
          <div key={g.roi} className={`lrow ${Math.abs(g.roi - i.targetRoi) < 1e-6 ? "mine" : ""}`}>
            <span>+{pct(g.roi)} in {end}d{Math.abs(g.roi - i.targetRoi) < 1e-6 ? " (yours)" : ""}</span>
            <div className="bar"><div style={{ width: pct(g.prob) }} /></div>
            <b className="mono">{Math.round(g.prob * 100)} in 100</b>
          </div>
        ))}
        <div className="lrow loss"><span>Ending with a loss</span><div className="bar"><div style={{ width: pct(p.probLoss) }} /></div><b className="mono">{Math.round(p.probLoss * 100)} in 100</b></div>
      </div>
      <p className="fine">Bigger goals are less likely. If your goal looks too hard, change it in words below, or compare other mixes above.</p>
      <div className={`verdict ${v.tone}`}><b>Reality check.</b> {v.text}</div>

      <div className="row between wrapr">
        <div style={{ minWidth: 220, flex: 1 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>Risk level: <b style={{ color: "var(--ink)" }}>{riskLabel(p.portfolioVol)}</b></div>
          <div className="riskbar">{[0, 1, 2, 3, 4].map((k) => <i key={k} className={k <= level ? `on ${level >= 3 ? "hot" : ""}` : ""} />)}</div>
        </div>
        <div className="small muted" style={{ flex: 2, minWidth: 220 }}>
          {i.stopLoss != null
            ? `The auto-sell would trigger in about ${Math.round(p.probStop * 100)} of 100 futures, capping the loss near ${pct(i.stopLoss)}.`
            : "No auto-sell is set, so a bad run is not cut short. You can add one in words below."}
        </div>
      </div>

      <h4>What is inside</h4>
      <div className="mix">
        {p.assets.map((a) => {
          const info = assetInfo(a.symbol);
          return (
            <div className="mixrow" key={a.symbol}>
              <div className="nm"><b>{info.name} <span className="muted small">{a.symbol}</span><NetTag net={info.network} /></b><span className="small muted">{KIND_LABEL[info.kind]} · {riskLabel(a.annVol)} risk</span></div>
              <div className="bar"><div style={{ width: pct(a.weight) }} /></div>
              <div className="mono">{pct(a.weight)} · {usd(a.weight * i.capitalUsd)}</div>
            </div>
          );
        })}
        {1 - p.assets.reduce((x, a) => x + a.weight, 0) > 0.0001 && (
          <div className="mixrow"><div className="nm"><b>Cash (USDC) <NetTag net="NEAR" /></b><span className="small muted">Stays safe, does not move</span></div><div className="bar"><div style={{ width: pct(1 - p.assets.reduce((x, a) => x + a.weight, 0)) }} /></div><div className="mono">{pct(1 - p.assets.reduce((x, a) => x + a.weight, 0))}</div></div>
        )}
      </div>

      <details className="pro">
        <summary>Pro details</summary>
        <div className="stats">
          <Stat label="Value at Risk (95%)" value={`-${pct(Math.max(0, p.var95), 1)}`} hint="Loss that is only exceeded in the worst 5 of 100 futures." />
          <Stat label="Expected shortfall" value={`-${pct(Math.max(0, p.cvar95), 1)}`} hint="Average loss across those worst 5 futures." />
          <Stat label="Chance of a loss" value={pct(p.probLoss)} hint="Share of futures that end below your starting amount." />
          <Stat label="Typical biggest dip" value={`-${pct(p.medianMaxDrawdown, 1)}`} hint="The usual worst drop from a peak along the way." />
          <Stat label="Yearly swings" value={pct(p.portfolioVol)} hint="Annualised volatility of this exact mix." />
          <Stat label="Median return" value={signed(p.medianRoi, 1)} hint="Middle outcome with no trend assumed (see reliability below)." />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Asset</th><th>Weight</th><th>Price</th><th>Return/yr (past)</th><th>Swings/yr</th><th>Return per risk</th><th>Worst fall</th></tr></thead>
            <tbody>
              {p.assets.map((a) => (
                <tr key={a.symbol}>
                  <td><b>{a.symbol}</b></td><td>{pct(a.weight)}</td><td>${a.last.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td className={a.annReturn >= 0 ? "good" : "bad"}>{signed(a.annReturn)}</td><td>{pct(a.annVol)}</td><td>{a.sharpe.toFixed(2)}</td><td className="bad">-{pct(a.maxDrawdown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.symbols.length > 1 && (
          <>
            <h4>How the assets move together (1 = in lockstep, 0 = unrelated)</h4>
            <div className="table-wrap">
              <table className="corr">
                <thead><tr><th></th>{p.symbols.map((x) => <th key={x}>{x}</th>)}</tr></thead>
                <tbody>
                  {p.symbols.map((x, r) => (
                    <tr key={x}><th>{x}</th>{p.correlation[r].map((c, k) => <td key={k} style={{ background: `color-mix(in srgb, var(--c1) ${Math.round(Math.max(0, c) * 30)}%, transparent)` }}>{c.toFixed(2)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </details>
      <Accuracy s={s} />
    </div>
  );
}
