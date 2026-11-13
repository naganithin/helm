"use client";
import { useEffect, useRef, useState } from "react";
import { compareOptions, type Option } from "@/lib/advisor";
import { assetInfo, type Strategy, type Symbol } from "@/lib/types";
import type { Helm } from "./useHelm";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const mixKey = (w: Partial<Record<Symbol, number>>) => Object.entries(w).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${k}${Math.round(v! * 100)}`).sort().join("-");

/**
 * Same goal, three honest ways to chase it. Found by searching ~240 mixes with the same Monte Carlo,
 * so the user sees the real trade-off between the chance of the goal and the size of a bad outcome.
 */
export function Options({ s, h, onPick, auto }: { s: Strategy; h: Helm; onPick: (s: Strategy) => void; auto: boolean }) {
  const { capitalUsd, horizonDays, targetRoi, stopLoss } = s.intent;
  const baseKey = `${capitalUsd}|${horizonDays}|${targetRoi}|${stopLoss}`;
  const [opts, setOpts] = useState<{ key: string; list: Option[] }>();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string>();
  const token = useRef(0);
  const market = h.market;

  async function run() {
    if (!market) return;
    const mine = ++token.current;
    setRunning(true); setErr(undefined);
    try {
      const list = await compareOptions(market, { capitalUsd, horizonDays, targetRoi, stopLoss });
      if (mine === token.current) setOpts({ key: baseKey, list });
    } catch (e) {
      if (mine === token.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === token.current) setRunning(false);
    }
  }
  useEffect(() => {
    if (auto && market && opts?.key !== baseKey && !running) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, market, baseKey]);

  const fresh = opts?.key === baseKey ? opts.list : undefined;
  if (!fresh) {
    return (
      <div className="aibox">
        <span className="eyebrow">Compare ways to chase this goal</span>
        <span className="small muted">{running ? "Testing about 240 mixes against two years of real prices..." : "See the safest, a balanced, and the most goal-focused mix for the same goal."}</span>
        {err && <span className="bad small">{err}</span>}
        {!running && <div><button className="btn sm" disabled={!market} onClick={run}>Compare options</button></div>}
      </div>
    );
  }
  const cur = mixKey(s.intent.weights);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row between wrapr">
        <div>
          <div className="eyebrow">{auto ? "You did not pick a mix, so choose your comfort level" : "Other ways to chase the same goal"}</div>
          <div className="small muted">Goal +{pct(targetRoi)} in {horizonDays} day{horizonDays === 1 ? "" : "s"}. A higher chance of the goal always comes with a bigger bad case.</div>
        </div>
        <button className="btn ghost sm" onClick={run} disabled={running}>{running ? "Testing..." : "Refresh"}</button>
      </div>
      <div className="outcomes">
        {fresh.map((o) => {
          const on = mixKey(o.weights) === cur;
          return (
            <div key={o.id} className={`oc ${o.id === "safe" ? "good" : o.id === "gain" ? "bad" : "mid"}`} style={on ? { outline: "2px solid var(--ink)", outlineOffset: 2 } : undefined}>
              <span className="t">{o.title}</span>
              <span className="d" style={{ marginBottom: 6 }}>{o.blurb}</span>
              <div className="chips" style={{ marginBottom: 6 }}>
                {Object.entries(o.weights).map(([k, v]) => <span className="tag" key={k} title={assetInfo(k).name}>{k} {pct(v!)}</span>)}
              </div>
              <div className="small"><b className="mono">{Math.round(o.probTarget * 100)} in 100</b> reach the goal</div>
              <div className="small"><b className="mono">{Math.round(o.probLoss * 100)} in 100</b> end with a loss</div>
              <div className="small">Bad case (1 in 20): <b className="mono bad">-{pct(Math.max(0, o.var95))}</b></div>
              <button className="btn sm primary" style={{ marginTop: 8 }} disabled={on}
                onClick={() => onPick(h.build({ ...s.intent, weights: o.weights, advised: undefined, rationale: `${o.title}: ${o.blurb}` }, `Chosen from compared options: ${o.title}`))}>
                {on ? "Selected" : "Use this mix"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
