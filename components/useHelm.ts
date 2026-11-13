"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import snapshot from "../data/snapshot.json";
import { decide, portfolioValue, type Prices } from "@/lib/agent";
import { agentKeyFromSeed, newAgentKey, type AgentKey } from "@/lib/agentKey";
import { executorFor, SETTLEMENT, type Ctx } from "@/lib/executor";
import { ftBalance, ftTransfer, nearBalance, sendTx, USDC_CIRCLE } from "@/lib/near";
import { project } from "@/lib/montecarlo";
import * as tp from "@/lib/tidepool";
import type { AgentEvent, Intent, MarketData, Projection, Strategy } from "@/lib/types";
import { SYMBOLS } from "@/lib/types";
import { usd } from "@/lib/format";
import { toast } from "./toast";

export type Mode = "demo" | "live";
const DAY = 86_400_000;
export const DEMO_PROMPT =
  "I have $10k. I want to diversify 60% into BTC, 30% ETH, 10% NEAR. I'm looking for 10% ROI in 2 months. Stop loss 10%.";

interface Persisted {
  strategies: Strategy[];
  balance: number; // demo: the simulated wallet balance
  vault?: AgentKey; // live: the Helm wallet (an Intents account), derived from the NEAR account's signature
  vaultDerived?: boolean; // true once the vault comes from the NEAR account (same wallet on every device)
  oldVaults?: AgentKey[]; // earlier random vaults, kept so nothing is ever lost
  addrs?: Record<string, tp.NetworkAddress>; // deposit addresses on other networks, reused until they expire
  clockOffset: number; // demo time travel
  history?: { t: number; v: number }[]; // total value (wallet + agents) over time, for the dashboard chart
}
const EMPTY = (demo: boolean): Persisted => ({ strategies: [], balance: demo ? 25_000 : 0, clockOffset: 0 });

const lastPrices = (d: MarketData): Prices => Object.fromEntries(SYMBOLS.map((s) => [s, d.closes[s]?.at(-1)])) as Prices;
const ev = (kind: AgentEvent["kind"], message: string, t: number, txRef?: string): AgentEvent => ({ kind, message, t, txRef });
const uid = () => Math.random().toString(36).slice(2, 7);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

export const nameOf = (i: Intent) =>
  SYMBOLS.filter((k) => i.weights[k]).map((k) => `${Math.round(i.weights[k]! * 100)}% ${k}`).join(" / ");

/** Same percentages, different dollar size (live trades what the wallet holds). */
function rescale(s: Strategy, capital: number): Strategy {
  const k = capital / s.intent.capitalUsd;
  const f = (a: number[]) => a.map((v) => v * k);
  const fan: Projection["fan"] = { p5: f(s.projection.fan.p5), p25: f(s.projection.fan.p25), p50: f(s.projection.fan.p50), p75: f(s.projection.fan.p75), p95: f(s.projection.fan.p95) };
  return { ...s, intent: { ...s.intent, capitalUsd: capital }, projection: { ...s.projection, fan } };
}

/** Human summary of what an edit changed. */
function describeChange(a: Intent, b: Intent): string {
  const out: string[] = [];
  if (a.capitalUsd !== b.capitalUsd) out.push(`amount $${a.capitalUsd} to $${b.capitalUsd}`);
  if (nameOf(a) !== nameOf(b)) out.push(`mix ${nameOf(a)} to ${nameOf(b)}`);
  if (a.targetRoi !== b.targetRoi) out.push(`target +${pct(a.targetRoi)} to +${pct(b.targetRoi)}`);
  if (a.horizonDays !== b.horizonDays) out.push(`horizon ${a.horizonDays}d to ${b.horizonDays}d`);
  if (a.stopLoss !== b.stopLoss) out.push(`stop-loss ${a.stopLoss != null ? `-${pct(a.stopLoss)}` : "none"} to ${b.stopLoss != null ? `-${pct(b.stopLoss)}` : "none"}`);
  return out.join(", ") || "no change";
}

export function useHelm(mode: Mode, owner: string | null, deriveSeed?: (owner: string) => Promise<Uint8Array>) {
  const demo = mode === "demo";
  const exec = useMemo(() => executorFor(demo), [demo]);
  const storeKey = `helm:${mode}:v5:${demo ? "local" : owner ?? "none"}`;
  const [market, setMarket] = useState<MarketData | null>(demo ? (snapshot as unknown as MarketData) : null);
  const [marketError, setMarketError] = useState<string>();
  const [prices, setPrices] = useState<Prices>(demo ? lastPrices(snapshot as unknown as MarketData) : {});
  const [state, setState] = useState<Persisted>(EMPTY(demo));
  const [hydratedKey, setHydratedKey] = useState<string>();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();
  // the real stage a slow action is in ("analyze" or a strategy id), shown while it runs
  const [stage, setStage] = useState<Record<string, string>>({});
  const setStageFor = useCallback((id: string, m?: string) => setStage((st) => {
    const n = { ...st };
    if (m) n[id] = m; else delete n[id];
    return n;
  }), []);
  const [vaultUsdc, setVaultUsdc] = useState<number | null>(null); // live: USDC in the Helm wallet
  const [vaultNear, setVaultNear] = useState(0); // live: NEAR in the Helm wallet that counts as buying power
  const [vaultGas, setVaultGas] = useState<number | null>(null); // live (Helm settlement): NEAR for network fees
  const [unlockError, setUnlockError] = useState<string>();
  const unlocking = useRef(false);
  const [vaultError, setVaultError] = useState<string>();
  const stateRef = useRef(state);
  stateRef.current = state;
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  const vaultUsdcRef = useRef<number | null>(null);
  vaultUsdcRef.current = vaultUsdc;
  const exiting = useRef(new Set<string>());
  const hydrated = hydratedKey === storeKey;

  const now = useCallback(() => Date.now() + stateRef.current.clockOffset, []);
  const setBusyFor = (id: string, v: boolean) => setBusy((b) => ({ ...b, [id]: v }));

  // load state for this (mode, owner)
  useEffect(() => {
    let next = EMPTY(demo);
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) next = JSON.parse(raw);
    } catch {}
    setState(next);
    setVaultUsdc(null);
    setHydratedKey(storeKey);
  }, [storeKey, demo]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {}
  }, [state, hydrated, storeKey]);

  /** Live: the Helm wallet is derived from a signature of the connected NEAR account, so it is the same everywhere. */
  const unlockVault = useCallback(async () => {
    if (demo || !owner || unlocking.current) return;
    unlocking.current = true;
    setUnlockError(undefined);
    try {
      const vault = deriveSeed ? await agentKeyFromSeed(await deriveSeed(owner)) : await newAgentKey();
      setState((st) => {
        if (st.vault?.accountId === vault.accountId) return { ...st, vaultDerived: !!deriveSeed };
        const old = st.vault && !st.vaultDerived ? [...(st.oldVaults ?? []), st.vault] : st.oldVaults;
        return { ...st, vault, vaultDerived: !!deriveSeed, oldVaults: old, addrs: undefined };
      });
    } catch (e) {
      setUnlockError(`Sign the Helm message in your wallet to open your Helm wallet. (${errMsg(e)})`);
    } finally {
      unlocking.current = false;
    }
  }, [demo, owner, deriveSeed]);
  useEffect(() => {
    if (demo || !hydrated || !owner || state.vaultDerived) return;
    void unlockVault();
  }, [demo, hydrated, owner, state.vaultDerived, unlockVault]);

  const refreshVault = useCallback(async () => {
    const vault = stateRef.current.vault;
    if (!vault) return;
    try {
      if (SETTLEMENT === "helm") {
        const [u, g] = await Promise.all([ftBalance(USDC_CIRCLE, vault.accountId), nearBalance(vault.accountId)]);
        setVaultUsdc(Number(u) / 1e6);
        setVaultNear(0);
        setVaultGas(g == null ? 0 : Number(g) / 1e24);
      } else {
        const b = await tp.balances(vault, [tp.USDC, tp.WNEAR]);
        setVaultUsdc(Number(b[tp.USDC] ?? 0n) / 1e6);
        setVaultNear(Number(b[tp.WNEAR] ?? 0n) / 1e24);
      }
      setVaultError(undefined);
    } catch (e) {
      setVaultError(errMsg(e));
    }
  }, []);
  const vaultId = state.vault?.accountId;
  useEffect(() => {
    if (demo || !vaultId) return;
    void refreshVault();
    const id = setInterval(refreshVault, 30_000);
    return () => clearInterval(id);
  }, [demo, vaultId, refreshVault]);

  // deposit addresses on other networks: created once for this Helm wallet and reused until they are about to expire
  const refreshAddrs = useCallback(async () => {
    const vault = stateRef.current.vault;
    if (demo || !vault || !stateRef.current.vaultDerived || SETTLEMENT === "helm") return;
    const now = Date.now();
    const next: Record<string, tp.NetworkAddress> = { ...(stateRef.current.addrs ?? {}) };
    let changed = false;
    for (const chain of Object.keys(tp.DEPOSIT_NETWORKS)) {
      const cur = next[chain];
      if (cur && new Date(cur.deadline).getTime() - now > 3_600_000) continue;
      try { next[chain] = await tp.networkAddress(chain, vault.accountId); changed = true; } catch { /* network unavailable now; try later */ }
    }
    if (changed) setState((st) => (st.vault?.accountId === vault.accountId ? { ...st, addrs: next } : st));
  }, [demo]);
  const derived = state.vaultDerived;
  useEffect(() => {
    if (demo || !vaultId || !derived) return;
    void refreshAddrs();
    const id = setInterval(refreshAddrs, 30 * 60_000);
    return () => clearInterval(id);
  }, [demo, vaultId, derived, refreshAddrs]);

  useEffect(() => {
    if (demo) return;
    fetch("/api/market")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setMarket(j); // history for the forecasts only; live prices come from /api/prices
      })
      .catch((e) => setMarketError(e.message));
  }, [demo]);
  useEffect(() => {
    if (demo) return;
    const poll = () =>
      fetch("/api/prices")
        .then((r) => r.json())
        .then((j) => j.prices && setPrices((p) => ({ ...p, ...j.prices })))
        .catch(() => {});
    const id = setInterval(poll, 15_000);
    poll();
    return () => clearInterval(id);
  }, [demo]);

  const upsert = useCallback((s: Strategy) => {
    setState((st) => ({
      ...st,
      strategies: st.strategies.some((x) => x.id === s.id) ? st.strategies.map((x) => (x.id === s.id ? s : x)) : [s, ...st.strategies],
    }));
  }, []);
  const logEvent = useCallback((id: string, e: AgentEvent) => {
    setState((st) => ({ ...st, strategies: st.strategies.map((x) => (x.id === id ? { ...x, events: [...x.events, e] } : x)) }));
  }, []);

  // The wallet's free money: demo ledger, or live on-chain USDC minus cash earmarked by running strategies.
  // cash a running strategy left unallocated: in the Tidepool flow it stays in the wallet (so it is held back here);
  // in Helm settlement it moves to the agent with the rest of the capital, so nothing is held back.
  const reserved = SETTLEMENT === "helm" ? 0 : state.strategies.reduce((a, s) => a + (s.status === "active" ? s.cash : 0), 0);
  const reservedRef = useRef(reserved);
  reservedRef.current = reserved;
  const free = demo ? state.balance : Math.max(0, (vaultUsdc ?? 0) + vaultNear * (prices.NEAR ?? 0) - reserved); // NEAR counts at market price
  const freeRef = useRef(free);
  freeRef.current = free;
  const ctx = useCallback((): Ctx => ({ vault: stateRef.current.vaultDerived ? stateRef.current.vault : undefined, free: demo ? stateRef.current.balance : freeRef.current }), [demo]);

  /** A draft strategy (with its Monte Carlo projection) for an intent. */
  const build = useCallback(
    (intent: Intent, why: string): Strategy => {
      if (!market) throw new Error("Market data not loaded yet");
      return {
        id: uid(), name: nameOf(intent), intent, projection: project(market, intent), status: "draft", units: {}, cash: 0, entryValue: 0, createdAt: Date.now(),
        events: [ev("created", why, Date.now())],
      };
    },
    [market],
  );

  const analyze = useCallback(
    async (prompt: string) => {
      if (!market) throw new Error("Market data not loaded yet");
      setBusyFor("analyze", true);
      try {
        setStageFor("analyze", "Reading your request");
        const res = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        const { intent, via, model } = j as { intent: Intent; via: string; model?: string };
        setStageFor("analyze", "Simulating 5,000 futures on real prices");
        await new Promise((r) => setTimeout(r, 30)); // let the label paint before the simulation runs
        return build(intent, via === "llm" ? `Decided by ${model?.split("/")[1]?.replace(":free", "") ?? "the AI"}` : "Parsed by the rule-based parser (the AI models were unavailable)");
      } finally {
        setBusyFor("analyze", false);
        setStageFor("analyze");
      }
    },
    [market, build, setStageFor],
  );

  /** Change parameters in plain language. Drafts can change anything; a running agent keeps its holdings, so only target, horizon and stop-loss change. */
  const refine = useCallback(
    async (s: Strategy, instruction: string): Promise<Strategy> => {
      if (!market) throw new Error("Market data not loaded yet");
      setBusyFor(`refine:${s.id}`, true);
      try {
        const res = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: instruction, current: s.intent }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        let intent = (j as { intent: Intent }).intent;
        let locked = false;
        if (s.status === "active") {
          locked = nameOf(intent) !== nameOf(s.intent) || intent.capitalUsd !== s.intent.capitalUsd;
          intent = { ...s.intent, targetRoi: intent.targetRoi, horizonDays: intent.horizonDays, stopLoss: intent.stopLoss, prompt: intent.prompt, rationale: intent.rationale ?? s.intent.rationale };
        }
        const projection = project(market, intent);
        const t = Date.now();
        const next: Strategy = {
          ...s, name: nameOf(intent), intent, projection,
          events: [...s.events, ev("tick", `You changed: ${describeChange(s.intent, intent)}${locked ? ". Mix and amount are locked while the agent holds positions" : ""}`, t)],
        };
        if (stateRef.current.strategies.some((x) => x.id === s.id)) upsert(next);
        return next;
      } finally {
        setBusyFor(`refine:${s.id}`, false);
      }
    },
    [market, upsert],
  );

  const close = useCallback(
    async (id: string, kind: "stop-loss" | "closed" | "manual" | "target") => {
      const s = stateRef.current.strategies.find((x) => x.id === id);
      if (!s || s.status !== "active" || exiting.current.has(id)) return;
      exiting.current.add(id);
      try {
        setStageFor(id, "Selling the positions");
        const r = await exec.sell(s, pricesRef.current, { ...ctx(), step: (m) => setStageFor(id, m) });
        const cash = s.cash + r.proceeds;
        const done = Object.keys(r.remaining).length === 0;
        const t = now();
        const ret = (cash / s.intent.capitalUsd - 1) * 100;
        setState((st) => ({
          ...st,
          balance: exec.simulated && done ? st.balance + cash : st.balance,
          strategies: st.strategies.map((x) =>
            x.id !== id ? x : {
              ...x, units: r.remaining, cash: done ? 0 : cash,
              status: done ? (kind === "stop-loss" ? "stopped" : "closed") : "active",
              exitValue: done ? cash : undefined,
              events: [
                ...x.events,
                ...r.notes.map((n) => ev(/^(Converted|Treasury paid)/.test(n) ? "tick" : "error", n, t)),
                ev(kind === "manual" || kind === "target" ? "closed" : kind, done
                  ? kind === "stop-loss"
                    ? `Stop-loss hit. Agent sold everything to USDC and returned $${cash.toFixed(2)} to the wallet (${ret.toFixed(1)}%)`
                    : kind === "target"
                      ? `Goal reached. Agent sold everything and returned $${cash.toFixed(2)} to the wallet (${ret.toFixed(1)}%)`
                    : kind === "manual"
                      ? `Closed by you. Agent sold everything to USDC and returned $${cash.toFixed(2)} to the wallet (${ret.toFixed(1)}%)`
                      : `Horizon reached. Closed and returned $${cash.toFixed(2)} to the wallet (${ret.toFixed(1)}%)`
                  : "Partial exit; remaining legs will retry on the next price update", t, r.txRef),
              ],
            },
          ),
        }));
        if (!exec.simulated) void refreshVault();
        if (done) {
          const how = kind === "stop-loss" ? "Stop-loss sold" : kind === "target" ? "Goal reached. Sold" : "Closed";
          toast(`${how} ${s.name}. ${usd(cash)} is back in your Helm wallet.`, { tone: cash >= s.intent.capitalUsd ? "good" : "bad" });
        }
      } catch (e) {
        logEvent(id, ev("error", `Exit failed, will retry: ${errMsg(e)}`, now()));
      } finally {
        exiting.current.delete(id);
        setStageFor(id);
      }
    },
    [exec, now, logEvent, ctx, refreshVault, setStageFor],
  );

  // The agents: on every price update each active strategy re-checks its own risk rule.
  useEffect(() => {
    for (const s of stateRef.current.strategies) {
      const d = decide(s, prices, now());
      if (d === "stop-loss") void close(s.id, "stop-loss");
      else if (d === "take-profit") void close(s.id, "target");
      else if (d === "expired") void close(s.id, "closed");
    }
  }, [prices, state.clockOffset, close, now]);

  const execute = useCallback(
    async (strategy: Strategy) => {
      if (busy[strategy.id]) return false;
      setError(undefined);
      setBusyFor(strategy.id, true);
      setStageFor(strategy.id, "Preparing this strategy's agent");
      let s = strategy;
      try {
        s = await exec.prepare(strategy); // live: this strategy's own agent account
        upsert(s); // saved as a draft first, so a failed fill never loses the agent key
        if (exec.simulated && stateRef.current.balance < s.intent.capitalUsd)
          throw new Error(`Wallet balance $${stateRef.current.balance.toFixed(2)} is below the $${s.intent.capitalUsd} needed. Deposit first.`);
        setStageFor(s.id, "Buying at live prices");
        const r = await exec.buy(s, pricesRef.current, { ...ctx(), step: (m) => setStageFor(s.id, m) });
        const t = now();
        const sized = r.capital !== s.intent.capitalUsd ? rescale(s, r.capital) : s;
        upsert({
          ...sized, status: "active", units: r.units, cash: r.cash, executedAt: t, entryValue: r.capital,
          events: [
            ...s.events,
            ...(r.capital !== s.intent.capitalUsd ? [ev("tick", `Sized to the $${r.capital.toFixed(2)} available in the wallet; percentages are unchanged`, t)] : []),
            ...r.notes.map((n) => ev(/^(Converted|Treasury paid)/.test(n) ? "tick" : "error", n, t)),
            ev("executed", exec.simulated
              ? `Wallet funded the agent and bought ${Object.keys(r.units).join(", ")} (simulated fills)`
              : SETTLEMENT === "helm" ? `Wallet sent ${r.capital.toFixed(2)} USDC to this agent's own NEAR account and opened ${Object.keys(r.units).join(", ")} at live prices` : `Wallet swapped USDC into ${Object.keys(r.units).join(", ")} and delivered it to this agent's account (NEAR Intents)`, t, r.txRef),
          ],
        });
        if (exec.simulated) setState((st) => ({ ...st, balance: st.balance - r.capital }));
        else void refreshVault();
        toast(`${s.name} is running. Its agent is watching the stop-loss.`, { tone: "good" });
        return true;
      } catch (e) {
        const m = errMsg(e);
        setError(m);
        if (stateRef.current.strategies.some((x) => x.id === s.id)) logEvent(s.id, ev("error", m, now()));
        toast(`Could not start ${s.name}: ${m}`, { tone: "bad" });
        return false;
      } finally {
        setBusyFor(strategy.id, false);
        setStageFor(strategy.id);
      }
    },
    [busy, exec, now, upsert, logEvent, ctx, refreshVault, setStageFor],
  );

  const closeNow = useCallback((id: string) => close(id, "manual"), [close]);

  /** Helm settlement: send USDC from the Helm wallet back to the connected NEAR wallet. Returns the transaction hash. */
  const withdraw = useCallback(async (usdc: number) => {
    const vault = stateRef.current.vaultDerived ? stateRef.current.vault : undefined;
    if (!vault || !owner) throw new Error("Unlock your Helm wallet first");
    if (!(usdc > 0)) throw new Error("Enter an amount");
    if (vaultUsdcRef.current != null && usdc > Math.max(0, vaultUsdcRef.current - reservedRef.current) + 1e-9) throw new Error("That is more than is free in your Helm wallet");
    const hash = await sendTx(vault, USDC_CIRCLE, [ftTransfer(owner, BigInt(Math.round(usdc * 1e6)), "Withdraw from Helm")]);
    await refreshVault();
    return hash;
  }, [owner, refreshVault]);
  const saveDraft = upsert;
  const remove = useCallback((id: string) => setState((st) => ({ ...st, strategies: st.strategies.filter((s) => s.id !== id || s.status === "active") })), []);
  const deposit = useCallback((usd: number) => setState((st) => ({ ...st, balance: st.balance + usd })), []);

  const advanceDay = useCallback(() => {
    if (!market) return;
    const i = 1 + Math.floor(Math.random() * (market.dates.length - 1));
    setPrices((p) => {
      const next = { ...p };
      for (const k of SYMBOLS) {
        const c = market.closes[k];
        if (c && next[k]) next[k] = next[k]! * (c[i] / c[i - 1]);
      }
      return next;
    });
    setState((st) => ({ ...st, clockOffset: st.clockOffset + DAY }));
  }, [market]);
  const shock = useCallback((pct: number) => setPrices((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v! * (1 + pct)])) as Prices), []);
  const resetDemo = useCallback(() => {
    if (!market) return;
    setPrices(lastPrices(market));
    setState(EMPTY(true));
  }, [market]);

  const values = useMemo(
    () => Object.fromEntries(state.strategies.map((s) => [s.id, s.status === "active" ? portfolioValue(s, prices) : s.exitValue ?? 0])),
    [state.strategies, prices],
  );
  const deployed = state.strategies.reduce((a, s) => a + (s.status === "active" ? values[s.id] : 0), 0);
  const total = free + deployed;

  // record the portfolio value now and then, for the dashboard chart
  useEffect(() => {
    if (!hydrated || (!demo && vaultUsdc == null)) return;
    setState((st) => {
      const hist = st.history ?? [];
      const last = hist.at(-1);
      const t = Date.now();
      if (last && (Math.abs(last.v - total) < 1e-6 ? t - last.t < 300_000 : t - last.t < (demo ? 800 : 20_000))) return st;
      return { ...st, history: [...hist, { t, v: total }].slice(-300) };
    });
  }, [total, hydrated, demo, vaultUsdc]);

  return {
    demo, exec, market, marketError, prices, strategies: state.strategies, vault: state.vaultDerived ? state.vault : undefined, vaultUsdc, vaultNear, vaultGas, settlement: SETTLEMENT, withdraw, vaultError, unlockError, unlockVault, addrs: state.addrs ?? {}, refreshAddrs, free, deployed, total, history: state.history ?? [],
    values, hydrated, busy, stage, error, now, analyze, build, refine, execute, closeNow, saveDraft, remove, deposit, refreshVault, advanceDay, shock, resetDemo, setError,
  };
}

export type Helm = ReturnType<typeof useHelm>;
