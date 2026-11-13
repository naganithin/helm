"use client";
import { useEffect, useMemo, useState } from "react";
import { assetInfo, KIND_LABEL, type Intent, type Strategy, type Symbol } from "@/lib/types";
import { NetTag } from "./Analysis";
import { useBasket } from "./basket";
import { PALETTE } from "./Charts";
import { usd } from "@/lib/format";
import type { Helm } from "./useHelm";

type Unit = "%" | "$";
interface Alloc { v: string; u: Unit }
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);

function evenSplit(syms: Symbol[]): Record<string, Alloc> {
  const each = Math.floor(100 / syms.length);
  return Object.fromEntries(syms.map((s, i) => [s, { v: String(i === 0 ? 100 - each * (syms.length - 1) : each), u: "%" as Unit }]));
}

/**
 * Turns the basket into a strategy: the user gives each asset a share (% or $), the goal and the time,
 * and can add any plain-language instruction on top ("target 12 USDC, stop at 9", "3 weeks").
 */
export function BasketBuilder({ h, onBuilt }: { h: Helm; onBuilt: (s: Strategy) => void }) {
  const b = useBasket();
  const [capital, setCapital] = useState("1000");
  const [alloc, setAlloc] = useState<Record<string, Alloc>>({});
  const [goal, setGoal] = useState("10");
  const [days, setDays] = useState("30");
  const [stop, setStop] = useState("");
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  // keep one row per basket asset; a fresh basket starts split evenly
  useEffect(() => {
    setAlloc((prev) => {
      const next: Record<string, Alloc> = {};
      for (const s of b.items) next[s] = prev[s] ?? { v: "", u: "%" };
      const fresh = b.items.length > 0 && b.items.every((s) => next[s].v === "");
      return fresh ? evenSplit(b.items) : next;
    });
  }, [b.items]);

  const cap = num(capital);
  const rows = useMemo(
    () => b.items.map((s) => {
      const a = alloc[s] ?? { v: "", u: "%" as Unit };
      const pct = a.u === "%" ? num(a.v) : cap > 0 ? (num(a.v) / cap) * 100 : 0;
      return { s, a, pct, money: (pct / 100) * cap };
    }),
    [b.items, alloc, cap],
  );
  const total = rows.reduce((x, r) => x + r.pct, 0);
  if (b.items.length === 0) return null;

  const set = (s: Symbol, p: Partial<Alloc>) => setAlloc((a) => ({ ...a, [s]: { ...(a[s] ?? { v: "", u: "%" }), ...p } }));

  async function build() {
    setErr(undefined);
    if (!(cap > 0)) return setErr("Enter how much you want to invest");
    if (total > 100.01) return setErr(`Your shares add up to ${total.toFixed(1)}%. They can be at most 100% (the rest stays in cash).`);
    const weights = Object.fromEntries(rows.filter((r) => r.pct > 0).map((r) => [r.s, r.pct / 100])) as Partial<Record<Symbol, number>>;
    if (!Object.keys(weights).length) return setErr("Give at least one asset a share");
    if (!(num(goal) >= 0) || !(num(days) >= 1)) return setErr("Enter a goal and a number of days");
    setBusy(true);
    try {
      let intent: Intent = {
        capitalUsd: cap, weights, targetRoi: num(goal) / 100, horizonDays: Math.round(num(days)),
        stopLoss: num(stop) > 0 ? num(stop) / 100 : null,
        prompt: `Basket of ${rows.filter((r) => r.pct > 0).map((r) => `${Math.round(r.pct * 10) / 10}% ${r.s}`).join(", ")}`,
      };
      if (command.trim()) {
        const res = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: command.trim(), current: intent }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        intent = j.intent as Intent;
      }
      onBuilt(h.build(intent, command.trim() ? `Built from your basket, then changed by: "${command.trim()}"` : "Built from your basket"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card basket-card">
      <div className="row between">
        <div className="eyebrow">Your basket · {b.items.length} asset{b.items.length === 1 ? "" : "s"}</div>
        <button className="btn ghost sm" onClick={b.clear}>Clear</button>
      </div>

      <div className="stackbar" aria-hidden>
        {rows.filter((r) => r.pct > 0).map((r, i) => <div key={r.s} style={{ width: `${Math.min(100, r.pct)}%`, background: PALETTE[i % PALETTE.length] }} title={`${r.s} ${r.pct.toFixed(1)}%`} />)}
        {total < 100 && <div style={{ flex: 1, background: "var(--line)" }} title="Cash" />}
      </div>

      <div className="bb-rows">
        {rows.map((r, i) => (
          <div className="bb-row" key={r.s}>
            <div>
              <i className="sw" style={{ background: PALETTE[i % PALETTE.length], marginRight: 8 }} /><b>{r.s}</b> <span className="muted small">{assetInfo(r.s).name}</span>
              <div className="small muted">{KIND_LABEL[assetInfo(r.s).kind]} <NetTag net={assetInfo(r.s).network} /></div>
            </div>
            <input value={r.a.v} onChange={(e) => set(r.s, { v: e.target.value })} inputMode="decimal" aria-label={`${r.s} amount`} placeholder="0" />
            <select value={r.a.u} onChange={(e) => set(r.s, { u: e.target.value as Unit })} aria-label={`${r.s} unit`}><option value="%">%</option><option value="$">$</option></select>
            <span className="mono small muted" style={{ minWidth: 90, textAlign: "right" }}>{r.a.u === "%" ? usd(r.money) : `${r.pct.toFixed(1)}%`}</span>
            <button className="x" onClick={() => b.remove(r.s)} aria-label={`Remove ${r.s}`}>×</button>
          </div>
        ))}
      </div>
      <div className="row between wrapr small">
        <span className={total > 100.01 ? "bad" : "muted"}>Invested {total.toFixed(1)}%{total < 99.99 ? ` · cash ${(100 - total).toFixed(1)}%` : ""}</span>
        <button className="btn ghost sm" onClick={() => setAlloc(evenSplit(b.items))}>Split evenly</button>
      </div>

      <div className="bb-fields">
        <label>Invest ($)<input value={capital} onChange={(e) => setCapital(e.target.value)} inputMode="decimal" /></label>
        <label>Goal (%)<input value={goal} onChange={(e) => setGoal(e.target.value)} inputMode="decimal" /></label>
        <label>Days<input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></label>
        <label>Stop-loss (%)<input value={stop} onChange={(e) => setStop(e.target.value)} inputMode="decimal" placeholder="none" /></label>
      </div>

      <label className="small muted" htmlFor="bb-cmd">Anything else, in words (optional)</label>
      <textarea id="bb-cmd" rows={2} value={command} onChange={(e) => setCommand(e.target.value)} placeholder='e.g. "target 12 USDC, stop at 9 USDC, 3 weeks" or "put more into the stocks"' />
      {err && <p className="bad small" role="alert" style={{ margin: 0 }}>{err}</p>}
      <button className="btn primary" disabled={busy || !h.market} onClick={build}>{busy ? "Building..." : "Analyse this basket"}</button>
    </div>
  );
}
