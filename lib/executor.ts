import { allocation, type Prices } from "./agent.ts";
import { newAgentKey, type AgentKey } from "./agentKey.ts";
import * as tp from "./tidepool.ts";
import { ftBalance, ftTransfer, nearBalance, NEAR, sendTx, storageDeposit, USDC_CIRCLE } from "./near.ts";
import { actionCreators } from "@near-js/transactions";
import type { Strategy, Symbol } from "./types.ts";
import { SYMBOLS } from "./types.ts";

type Units = Partial<Record<Symbol, number>>;

export interface BuyResult {
  units: Units;
  /** USDC left over (unallocated weight + legs that failed and were refunded) */
  cash: number;
  /** capital actually deployed (live testnet is limited by the faucet balance) */
  capital: number;
  notes: string[];
  txRef?: string;
}
export interface SellResult {
  proceeds: number;
  /** units that could not be sold; the agent retries them on the next tick */
  remaining: Units;
  notes: string[];
  txRef?: string;
}
/** Live only: the global vault account that funds agents, and how much of it is free to commit. */
export interface Ctx {
  vault?: AgentKey;
  free: number;
  /** Reports the real stage a slow live action is in, so the UI can show it while it runs. */
  step?: (label: string) => void;
}
export interface Executor {
  simulated: boolean;
  /** Returns the key the strategy trades with (live: a fresh per-strategy agent account). */
  prepare(s: Strategy): Promise<Strategy>;
  buy(s: Strategy, prices: Prices, ctx: Ctx): Promise<BuyResult>;
  sell(s: Strategy, prices: Prices, ctx: Ctx): Promise<SellResult>;
}

const FEE = 0.001;
const rid = () => `sim-${Math.random().toString(36).slice(2, 10)}`;

/** Demo: fills at the reference price less a 0.1% fee. No network. */
export const simulatedExecutor: Executor = {
  simulated: true,
  async prepare(s) {
    return s;
  },
  async buy(s, prices) {
    const units: Units = {};
    let spent = 0;
    for (const { symbol, usd } of allocation(s.intent, s.intent.capitalUsd)) {
      units[symbol] = (usd * (1 - FEE)) / prices[symbol]!;
      spent += usd;
    }
    return { units, cash: s.intent.capitalUsd - spent, capital: s.intent.capitalUsd, notes: [], txRef: rid() };
  },
  async sell(s, prices) {
    const proceeds = SYMBOLS.reduce((a, k) => a + (s.units[k] ?? 0) * (prices[k] ?? 0) * (1 - FEE), 0);
    return { proceeds, remaining: {}, notes: [], txRef: rid() };
  },
};

const fmt = (v: bigint, dec: number) => Number(v) / 10 ** dec;
const toBase = (usd: number, dec: number) => BigInt(Math.floor(usd * 10 ** dec));

/**
 * Live (Tidepool testnet). Money flows vault -> agent -> vault:
 *  - buy: the global vault account swaps USDC into each asset and Tidepool delivers the output
 *    straight into the strategy's own agent account (one atomic hop, no separate transfer);
 *  - sell: the agent account signs the exit itself (no wallet popup) and the USDC proceeds are
 *    delivered back to the vault.
 * So several strategies never share balances and each can be stopped independently.
 */
export const tidepoolExecutor: Executor = {
  simulated: false,
  async prepare(s) {
    const bad = Object.keys(s.intent.weights).filter((k) => !tp.isTradable(k));
    if (bad.length) throw new Error(`${bad.join(", ")} can't be traded on Tidepool testnet. Tradable: ${Object.keys(tp.TRADABLE).join(", ")}.`);
    return s.agent ? s : { ...s, agent: await newAgentKey() };
  },
  async buy(s, _prices, { vault, free }) {
    if (!vault) throw new Error("Wallet vault not ready yet");
    const usdcDec = await tp.decimalsOf(tp.USDC);
    const bal = await tp.balances(vault, [tp.USDC, tp.WNEAR]);
    let onChain = fmt(bal[tp.USDC] ?? 0n, usdcDec);
    const pre: string[] = [];
    // NEAR in the Helm wallet counts as buying power: convert just enough of it to USDC first
    const wanted = Math.min(s.intent.capitalUsd, free);
    const wnear = bal[tp.WNEAR] ?? 0n;
    if (onChain < wanted && wnear > 0n) {
      const nearPrice = (await tp.tokens()).get(tp.WNEAR)?.price ?? 0;
      if (nearPrice > 0) {
        const need = toBase(((wanted - onChain) * 1.03) / nearPrice, 24);
        const sell = need < wnear ? need : wnear;
        try {
          const r = await tp.swap(vault, tp.WNEAR, tp.USDC, sell, vault.accountId);
          const got = fmt(r.amountOut, usdcDec);
          onChain += got;
          pre.push(`Converted ${fmt(sell, 24).toFixed(4)} NEAR from the wallet into ${got.toFixed(2)} USDC`);
        } catch (e) {
          pre.push(`Could not convert NEAR to USDC: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    const have = Math.min(onChain, free);
    if (have < 1) throw new Error(`Wallet balance too low: ${have.toFixed(2)} USDC free. Add funds in the Wallet section.`);
    const capital = Math.min(s.intent.capitalUsd, Math.floor(have * 100) / 100);
    const units: Units = {};
    const notes: string[] = [];
    let spent = 0;
    let txRef: string | undefined;
    for (const { symbol, usd } of allocation(s.intent, capital)) {
      const asset = tp.TRADABLE[symbol as tp.TradableSymbol];
      try {
        const r = await tp.swap(vault, tp.USDC, asset, toBase(usd, usdcDec), s.agent!.accountId);
        units[symbol] = fmt(r.amountOut, await tp.decimalsOf(asset));
        spent += usd;
        txRef ??= r.txRef;
      } catch (e) {
        notes.push(`${symbol} leg failed, ${usd.toFixed(2)} USDC stays in the wallet: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!Object.keys(units).length) throw new Error(notes.join(" | ") || "No leg could be filled");
    return { units, cash: capital - spent, capital, notes: [...pre, ...notes], txRef };
  },
  async sell(s, _prices, { vault }) {
    if (!vault) throw new Error("Wallet vault not ready yet");
    const key = s.agent!;
    const usdcDec = await tp.decimalsOf(tp.USDC);
    const syms = SYMBOLS.filter((k) => (s.units[k] ?? 0) > 0);
    const assets = syms.map((k) => tp.TRADABLE[k as tp.TradableSymbol]);
    const held = await tp.balances(key, assets);
    let proceeds = 0;
    let txRef: string | undefined;
    const remaining: Units = {};
    const notes: string[] = [];
    for (const k of syms) {
      const asset = tp.TRADABLE[k as tp.TradableSymbol];
      const amount = held[asset] ?? 0n; // sell the exact on-chain balance, not a float
      if (amount === 0n) continue;
      try {
        const r = await tp.swap(key, asset, tp.USDC, amount, vault.accountId);
        proceeds += fmt(r.amountOut, usdcDec);
        txRef ??= r.txRef;
      } catch (e) {
        remaining[k] = s.units[k];
        notes.push(`${k} exit failed, retrying: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { proceeds, remaining, notes, txRef };
  },
};
/** Which venue live mode settles on: Helm's own settlement (default) or the Tidepool NEAR Intents sandbox. */
export const SETTLEMENT: "helm" | "tidepool" = process.env.NEXT_PUBLIC_SETTLEMENT === "tidepool" ? "tidepool" : "helm";
export const executorFor = (demo: boolean) => (demo ? simulatedExecutor : SETTLEMENT === "tidepool" ? tidepoolExecutor : helmExecutor);
let houseCache: { at: number; info: { account: string; registered: boolean } | null } | undefined;
/** The treasury (market maker) account, from /api/treasury; cached for a minute. */
async function treasury(): Promise<{ account: string; registered: boolean } | null> {
  if (houseCache && Date.now() - houseCache.at < 60_000) return houseCache.info;
  const j = await fetch("/api/treasury").then((r) => r.json()).catch(() => null);
  const info = j?.configured ? { account: j.account as string, registered: !!j.registered } : null;
  houseCache = { at: Date.now(), info };
  return info;
}

const AGENT_GAS = NEAR / 20n; // 0.05 NEAR so the agent account can pay for its own exit transaction

/**
 * Helm's own settlement (live, NEAR testnet). Money is real and on-chain; fills are priced at live market prices.
 *  - run: the Helm wallet creates the strategy's agent account (0.05 NEAR for gas), registers it with the USDC
 *    contract and transfers the strategy's USDC to it. The position is recorded at live prices (0.1% fee).
 *  - exit (stop-loss, close, horizon): the agent signs its own USDC transfer back to the Helm wallet, worth the
 *    position's value at that moment, capped at what it holds. Every step is a NEAR transaction on NearBlocks.
 */
export const helmExecutor: Executor = {
  simulated: false,
  async prepare(s) {
    return s.agent ? s : { ...s, agent: await newAgentKey() };
  },
  async buy(s, prices, { vault, free, step }) {
    if (!vault) throw new Error("Unlock your Helm wallet first");
    step?.("Checking your Helm wallet");
    const onChain = Number(await ftBalance(USDC_CIRCLE, vault.accountId)) / 1e6;
    const have = Math.min(onChain, free);
    if (have < 1) throw new Error(`Wallet balance too low: ${have.toFixed(2)} USDC available. Add funds in the Wallet section.`);
    const gas = await nearBalance(vault.accountId);
    const agentHas = await nearBalance(s.agent!.accountId);
    const needGas = agentHas != null && agentHas >= AGENT_GAS / 2n ? NEAR / 50n : AGENT_GAS + NEAR / 50n;
    if (gas == null || gas < needGas) throw new Error("Your Helm wallet needs a little NEAR for network fees. Send funds again from the Wallet section; it tops up NEAR automatically.");
    const capital = Math.min(s.intent.capitalUsd, Math.floor(have * 100) / 100);
    const legs = allocation(s.intent, capital);
    const missing = legs.filter((l) => !(prices[l.symbol]! > 0)).map((l) => l.symbol);
    if (missing.length) throw new Error(`No live price for ${missing.join(", ")} right now. Try again in a moment.`);
    const agent = s.agent!.accountId;
    const agentGas = await nearBalance(agent);
    if (agentGas == null || agentGas < AGENT_GAS / 2n) {
      step?.("Creating this strategy's agent account");
      await sendTx(vault, agent, [actionCreators.transfer(AGENT_GAS)]); // creates the agent's NEAR account (only once, also on retries)
    }
    step?.(`Sending ${capital.toFixed(2)} USDC to the agent`);
    const txRef = await sendTx(vault, USDC_CIRCLE, [storageDeposit(agent), ftTransfer(agent, BigInt(Math.round(capital * 1e6)), `Helm strategy ${s.id}`)]);
    const units: Units = {};
    let spent = 0;
    for (const { symbol, usd } of legs) { units[symbol] = (usd * (1 - FEE)) / prices[symbol]!; spent += usd; }
    return { units, cash: capital - spent, capital, notes: [], txRef };
  },
  async sell(s, prices, { vault, step }) {
    if (!vault) throw new Error("Unlock your Helm wallet first");
    step?.("Selling the positions at live prices");
    const key = s.agent!;
    const value = SYMBOLS.reduce((a, k) => a + (s.units[k] ?? 0) * (prices[k] ?? 0) * (1 - FEE), 0);
    const owed = BigInt(Math.floor((value + s.cash) * 1e6)); // what the position is worth now, cash included
    const held = await ftBalance(USDC_CIRCLE, key.accountId);
    const house = await treasury();
    const notes: string[] = [];
    let paid = 0n;
    let txRef: string | undefined;
    step?.("Returning the money to your Helm wallet");
    if (owed <= held) {
      // a loss (or flat): the wallet gets what the position is worth; the rest goes to the treasury, the other side of the trade
      const loss = held - owed;
      const actions = [ftTransfer(vault.accountId, owed, `Helm strategy ${s.id} exit`)];
      if (loss > 0n && house?.registered) actions.push(ftTransfer(house.account, loss, `Helm strategy ${s.id} loss`));
      if (owed > 0n || actions.length > 1) txRef = await sendTx(key, USDC_CIRCLE, owed > 0n ? actions : actions.slice(1));
      paid = owed;
    } else {
      // a gain: return the deposit, then the treasury pays the gain after checking this exit on-chain
      txRef = await sendTx(key, USDC_CIRCLE, [ftTransfer(vault.accountId, held, `Helm strategy ${s.id} exit`)]);
      paid = held;
      const gain = owed - held;
      if (house) {
        step?.("Treasury is verifying and paying your gain");
        const r = await fetch("/api/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exitTx: txRef, agent: key.accountId, wallet: vault.accountId, paid: held.toString(), gain: gain.toString() }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { paid += gain; notes.push(`Treasury paid the $${(Number(gain) / 1e6).toFixed(2)} gain`); }
        else notes.push(`The gain of $${(Number(gain) / 1e6).toFixed(2)} was not paid: ${j.error ?? `HTTP ${r.status}`}`);
      } else notes.push("No treasury is set up, so only the deposit was returned");
    }
    return { proceeds: Number(paid) / 1e6 - s.cash, remaining: {}, notes, txRef };
  },
};