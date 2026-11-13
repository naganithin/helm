"use client";
import { useState } from "react";
import type { Strategy } from "@/lib/types";
import { SYMBOLS } from "@/lib/types";
import { accountUrl, txUrl } from "@/lib/near";
import { pct, signedUsd, usd } from "@/lib/format";
import { Analysis } from "./Analysis";
import { PortfolioSummary } from "./PortfolioSummary";
import { toast } from "./toast";
import { Confirm, Delta, Stage } from "./ui";
import type { Helm } from "./useHelm";

// other components still import usd from here
export { usd } from "@/lib/format";

const DAY = 86_400_000;

/** Change a strategy's parameters in plain language ("stop loss 15%", "target 12 USDC", "more ETH"). */
export function Refine({ s, h, onChange }: { s: Strategy; h: Helm; onChange?: (s: Strategy) => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string>();
  const busy = h.busy[`refine:${s.id}`];
  const cap = s.intent.capitalUsd;
  const money = (v: number) => (Math.round(v * 100) / 100).toString();
  const ideas = s.status === "active"
    ? ["Stop loss 10%", `Target ${money(cap * 1.2)} USDC`, `Stop at ${money(cap * 0.9)} USDC`]
    : ["Stop loss 8%", `Target ${money(cap * 1.2)} USDC`, `Stop at ${money(cap * 0.9)} USDC`, "Add 10% gold", "3 weeks"];
  async function go(value = text) {
    setErr(undefined);
    try {
      const next = await h.refine(s, value.trim());
      setText("");
      onChange?.(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="refinebox">
      <label className="small muted" htmlFor={`refine-${s.id}`}>Change it in words</label>
      <form className="refinerow" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) void go(); }}>
        <input id={`refine-${s.id}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. target 12 USDC, stop at 9 USDC" />
        <button className="btn primary" type="submit" disabled={!text.trim() || busy}>{busy ? "Updating…" : "Update"}</button>
      </form>
      <div className="chips">{ideas.map((x) => <button key={x} type="button" className="chip" disabled={busy} onClick={() => setText(x)}>{x}</button>)}</div>
      {err && <p className="bad small" role="alert" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}

/** One track from the auto-sell price to the target, with today's value on it (the same lines as the forecast chart). */
function Track({ v, cap, floor, target, day, days }: { v: number; cap: number; floor: number; target: number; day: number; days: number }) {
  const span = target - floor || 1;
  const at = (x: number) => `${Math.max(0, Math.min(100, ((x - floor) / span) * 100))}%`;
  return (
    <div>
      <div className="track" role="img" aria-label={`Value ${usd(v)}, auto-sell at ${usd(floor)}, target ${usd(target)}`}>
        <div className="rail" />
        <div className="end stp" />
        <div className="end tgt" />
        <div className="start" style={{ left: at(cap) }} title={`Started at ${usd(cap)}`} />
        <div className="now" style={{ left: at(v) }} />
      </div>
      <div className="track-l">
        <span>Auto-sell <b>{usd(floor)}</b></span>
        <span>Day {day.toFixed(1)} of {days}</span>
        <span>Target <b>{usd(target)}</b></span>
      </div>
    </div>
  );
}

function Card({ s, h }: { s: Strategy; h: Helm }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const running = s.status === "active";
  const cap = s.intent.capitalUsd;
  const v = h.values[s.id] ?? 0;
  const ret = running ? v / cap - 1 : s.exitValue != null ? s.exitValue / cap - 1 : null;
  const sl = s.intent.stopLoss;
  const floor = sl != null ? cap * (1 - sl) : Math.min(cap, v) * 0.9;
  const target = cap * (1 + s.intent.targetRoi);
  const elapsed = running && s.executedAt != null ? Math.max(0, (h.now() - s.executedAt) / DAY) : 0;
  const label = running ? "running" : s.status === "stopped" ? "stopped out" : s.status === "closed" ? "closed" : "draft";
  const cls = running ? "running" : s.status;
  const holdings = SYMBOLS.filter((k) => (s.units[k] ?? 0) > 0).map((k) => ({ k, usd: (s.units[k] ?? 0) * (h.prices[k] ?? 0) }));
  const stage = h.stage[s.id];

  const del = () => {
    h.remove(s.id);
    toast(`Deleted ${s.name}`, { action: { label: "Undo", run: () => h.saveDraft(s) } });
  };

  return (
    <article className={`strat ${cls}`}>
      <div className="strat-top">
        <div>
          <div className="strat-name">{s.name}</div>
          <div className="strat-meta">{usd(cap)} · {s.intent.horizonDays} days · goal +{pct(s.intent.targetRoi, 0)}{sl != null ? ` · auto-sell at -${pct(sl, 0)}` : ""}</div>
        </div>
        <span className={`pill ${cls}`}>{running && <span className="dot" />}{label}</span>
      </div>

      {running && (
        <>
          <div className="strat-val">
            <span className="big">{usd(v)}</span>
            <span><Delta v={ret! * 100} /> <span className={ret! >= 0 ? "good" : "bad"}>{signedUsd(v - cap)}</span></span>
          </div>
          <Track v={v} cap={cap} floor={floor} target={target} day={elapsed} days={s.intent.horizonDays} />
          <div className="chips">
            {holdings.map((x) => <span className="tag" key={x.k}>{x.k} {usd(x.usd)}</span>)}
            {s.cash > 0.005 && <span className="tag">USDC {usd(s.cash)} unspent</span>}
          </div>
          {s.agent && (
            <div className="row small muted" style={{ flexWrap: "wrap" }}>
              <span>Agent account</span>
              <a className="hash" title={s.agent.accountId} href={accountUrl(s.agent.accountId)} target="_blank" rel="noreferrer">{s.agent.accountId.slice(0, 10)}…{s.agent.accountId.slice(-6)} ↗</a>
              <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(s.agent!.accountId); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
            </div>
          )}
        </>
      )}

      {s.status === "draft" && (
        <>
          <div className="stats">
            <div className="stat"><div className={`stat-v ${s.projection.probTarget >= 0.4 ? "good" : "bad"}`}>{pct(s.projection.probTarget, 0)}</div><div className="stat-l">chance of goal</div></div>
            <div className="stat"><div className="stat-v">{pct(s.projection.medianRoi)}</div><div className="stat-l">typical result</div></div>
            <div className="stat"><div className="stat-v">-{pct(Math.max(0, s.projection.var95))}</div><div className="stat-l">bad-case loss</div></div>
          </div>
          {!stage && (() => { const last = s.events[s.events.length - 1]; return last?.kind === "error" ? <div className="verdict bad" role="alert"><b>Last attempt failed:</b> {last.message}</div> : null; })()}
          {!stage && <p className="fine">A plan only. No money has moved yet.</p>}
        </>
      )}

      {(s.status === "stopped" || s.status === "closed") && ret != null && (
        <div className="strat-val">
          <span className="big">{usd(s.exitValue ?? 0)}</span>
          <span><Delta v={ret * 100} /> <span className="muted small">returned to your Helm wallet</span></span>
        </div>
      )}

      <Stage text={stage} />

      {(s.status === "draft" || running) && !stage && <Refine s={s} h={h} />}

      <div className="row wrapr">
        {s.status === "draft" && <button className="btn primary" disabled={h.busy[s.id]} onClick={() => h.execute(s)}>{h.busy[s.id] ? "Starting…" : `Invest ${usd(cap)}`}</button>}
        {running && <button className="btn danger sm" disabled={!!stage} onClick={() => setAsking(true)}>Close now</button>}
        {!running && !stage && <button className="btn ghost" onClick={del}>Delete</button>}
        <button className="btn ghost" onClick={() => setOpen(!open)}>{open ? "Hide details" : "Details"}</button>
      </div>

      {asking && (
        <Confirm title="Close this strategy?" confirm={`Sell and return ${usd(v)}`} danger
          onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); void h.closeNow(s.id); }}>
          The agent sells everything at live prices and returns about {usd(v)} to your Helm wallet. This can&apos;t be undone.
        </Confirm>
      )}

      {open && (
        <>
          <Analysis s={s} />
          <h4>Agent log</h4>
          <ul className="log">
            {s.events.map((e, i) => (
              <li key={i} className={e.kind === "error" ? "bad" : ""}>
                <time>{new Date(e.t).toLocaleString()}</time>
                {e.message}
                {e.txRef && (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(e.txRef) ? <> <a className="good" href={txUrl(e.txRef)} target="_blank" rel="noreferrer">view on NearBlocks ↗</a></> : <code> {e.txRef}</code>)}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

function Section({ title, tone, items, h, empty, onTrade }: { title: string; tone: string; items: Strategy[]; h: Helm; empty: string; onTrade?: () => void }) {
  return (
    <div className="sec">
      <div className="sec-head">
        <h2 className="display">{title}</h2>
        <span className="count">{items.length}</span>
        <span className="grow" />
        <span className="fine">{tone}</span>
      </div>
      {items.length ? (
        <div className="strats">{items.map((s) => <Card key={s.id} s={s} h={h} />)}</div>
      ) : (
        <div className="empty-note">
          <span>{empty}</span>
          {onTrade && <button className="btn primary sm" onClick={onTrade}>New strategy</button>}
        </div>
      )}
    </div>
  );
}

export function StrategiesView({ h, onTrade }: { h: Helm; onTrade: () => void }) {
  const by = (st: Strategy["status"][]) => h.strategies.filter((s) => st.includes(s.status));
  return (
    <section className="view">
      <div className="view-head">
        <h1 className="display">Your strategies</h1>
        <div className="col" style={{ gap: 12, alignItems: "flex-start" }}>
          <p>Each running strategy is its own agent with its own account and stop-loss. Drafts are plans that have not touched any money.</p>
          <button className="btn primary" onClick={onTrade}>New strategy</button>
        </div>
      </div>
      <PortfolioSummary strategies={h.strategies} prices={h.prices} market={h.market} now={h.now()} />
      <Section title="Running" tone="An agent is watching each stop-loss." items={by(["active"])} h={h} onTrade={onTrade} empty="Nothing is running yet. Describe a goal and invest; its agent starts watching right away." />
      <Section title="Drafts" tone="Saved plans. No money moved." items={by(["draft"])} h={h} onTrade={onTrade} empty="No drafts. Save an analysis from Trade to come back to it later." />
      <Section title="Closed" tone="Finished or stopped out. Money is back in the wallet." items={by(["stopped", "closed"])} h={h} empty="No closed strategies yet." />
      <p className="fine" style={{ marginTop: 32 }}>Agents run in this browser tab and check their stop-loss on every price update{h.demo ? "" : " (every 15 s)"}. Keep the tab open.</p>
    </section>
  );
}
