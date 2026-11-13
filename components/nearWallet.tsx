"use client";
import "@near-wallet-selector/modal-ui/styles.css";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { actionCreators } from "@near-js/transactions";
import { Buffer } from "buffer"; // the wallet selector checks Buffer.isBuffer(nonce); browsers have no global Buffer
import { walletMessage, walletSeed } from "@/lib/agentKey";
import { SETTLEMENT } from "@/lib/executor";
import { nearBalance, NEAR as ONE_NEAR, storageDeposit, ftTransfer, USDC_CIRCLE } from "@/lib/near";

// The NEAR network the trading venue runs on. A leftover session from the other network is disconnected.
export const NETWORK = (process.env.NEXT_PUBLIC_WALLET_NETWORK ?? "testnet") as "mainnet" | "testnet";
const VERIFIER = "verifier.tidepool-sandbox.testnet";
const RPC = NETWORK === "testnet" ? ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"] : ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"];

/** Tokens the connected NEAR wallet can send straight into the Helm wallet (depends on the settlement venue). */
export type Sendable = "USDC" | "NEAR";
export const SENDABLE: Partial<Record<Sendable, { contract: string; decimals: number }>> = SETTLEMENT === "helm"
  ? { USDC: { contract: USDC_CIRCLE, decimals: 6 } }
  : { USDC: { contract: "usdc.tidepool-sandbox.testnet", decimals: 6 }, NEAR: { contract: "wnear.tidepool-sandbox.testnet", decimals: 24 } };
const tokenOf = (t: Sendable) => { const x = SENDABLE[t]; if (!x) throw new Error(`${t} is not accepted here`); return x; };

interface State { ready: boolean; accountId: string | null; error?: string; notice?: string }
const SERVER: State = { ready: false, accountId: null };
let state: State = SERVER;
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };

let selector: WalletSelector | undefined;
let modal: ReturnType<typeof setupModal> | undefined;
let booting: Promise<void> | undefined;

const otherNetwork = (id: string) => (NETWORK === "testnet" ? id.endsWith(".near") : id.endsWith(".testnet"));

function boot(): Promise<void> {
  booting ??= (async () => {
    const s = await setupWalletSelector({ network: NETWORK, modules: NETWORK === "testnet" ? [setupMeteorWallet()] : [setupMeteorWallet(), setupHotWallet()] });
    selector = s;
    modal = setupModal(s, { contractId: "" });
    const sync = () => {
      const id = s.store.getState().accounts.find((a) => a.active)?.accountId ?? null;
      if (id && otherNetwork(id)) {
        set({ accountId: null, notice: `Disconnected ${id}: it belongs to a different NEAR network. Connect again with Meteor.` });
        s.wallet().then((w) => w.signOut()).catch(() => {});
        return;
      }
      set({ accountId: id });
    };
    sync();
    s.store.observable.subscribe(sync);
    set({ ready: true });
  })().catch((e) => { booting = undefined; set({ error: e instanceof Error ? e.message : String(e) }); });
  return booting;
}

async function rpc(method: string, params: unknown) {
  let last: unknown;
  for (const url of RPC) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "helm", method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.data ?? j.error.message ?? "RPC error");
      return j.result;
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("NEAR RPC unavailable");
}

/** Decimal string -> base units without floating-point loss ("1.5" with 24 decimals). */
export function toUnits(amount: string, decimals: number): bigint {
  const [w, f = ""] = amount.trim().split(".");
  if (!/^\d*$/.test(w) || !/^\d*$/.test(f)) throw new Error("Enter a number");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** How much of a token the connected account holds. */
export async function readBalance(token: Sendable, accountId: string): Promise<number> {
  const t = tokenOf(token);
  const res = await rpc("query", { request_type: "call_function", finality: "final", account_id: t.contract, method_name: "ft_balance_of", args_base64: btoa(JSON.stringify({ account_id: accountId })) });
  const raw = JSON.parse(new TextDecoder().decode(new Uint8Array(res.result)));
  return Number(BigInt(raw)) / 10 ** t.decimals;
}

/**
 * Tokens with the same symbol that the account holds but Helm cannot accept (for example Circle's USDC,
 * which is a different contract from the USDC the exchange trades). Used to explain a "0" balance.
 */
export async function otherTokensNamed(token: Sendable, accountId: string): Promise<{ contract: string; amount: number }[]> {
  const api = NETWORK === "testnet" ? "https://test.api.fastnear.com" : "https://api.fastnear.com";
  const r = await fetch(`${api}/v1/account/${encodeURIComponent(accountId)}/ft`);
  if (!r.ok) return [];
  const j = (await r.json()) as { tokens?: { contract_id: string; balance: string }[] };
  const out: { contract: string; amount: number }[] = [];
  for (const t of j.tokens ?? []) {
    if (t.contract_id === SENDABLE[token]?.contract || !t.balance || t.balance === "0") continue;
    try {
      const res = await rpc("query", { request_type: "call_function", finality: "final", account_id: t.contract_id, method_name: "ft_metadata", args_base64: btoa("{}") });
      const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(res.result))) as { symbol: string; decimals: number };
      const want = token === "NEAR" ? /^w?near$/i : /^usdc(\.e)?$/i;
      if (want.test(meta.symbol)) out.push({ contract: t.contract_id, amount: Number(BigInt(t.balance)) / 10 ** meta.decimals });
    } catch { /* not a standard token */ }
  }
  return out;
}

/** Move a token from the connected wallet into the Helm wallet: one signed ft_transfer_call into NEAR Intents. */
export async function sendToHelmWallet(token: Sendable, amount: string, helmAccountId: string) {
  if (!selector) throw new Error("Wallet not ready");
  const t = tokenOf(token);
  const wallet = await selector.wallet();
  if (SETTLEMENT === "helm") {
    // Helm settlement: the Helm wallet is a plain NEAR account. First time, also send it a little NEAR for
    // network fees (this creates the account), register it with the token, then transfer the USDC.
    const gas = await nearBalance(helmAccountId).catch(() => null);
    const txs: { receiverId: string; actions: ReturnType<typeof ftTransfer>[] }[] = [];
    if (gas == null || gas < ONE_NEAR / 10n) txs.push({ receiverId: helmAccountId, actions: [actionCreators.transfer((ONE_NEAR * 3n) / 10n)] });
    txs.push({ receiverId: t.contract, actions: [storageDeposit(helmAccountId), ftTransfer(helmAccountId, toUnits(amount, t.decimals), "Deposit to Helm")] });
    return wallet.signAndSendTransactions({ transactions: txs });
  }
  return wallet.signAndSendTransaction({
    receiverId: t.contract,
    actions: [actionCreators.functionCall("ft_transfer_call", { receiver_id: VERIFIER, amount: toUnits(amount, t.decimals).toString(), msg: helmAccountId }, 100_000_000_000_000n, 1n)],
  });
}

/** Ask the connected wallet to sign the fixed Helm message; the result seeds the same Helm wallet every time. */
export async function deriveWalletSeed(accountId: string): Promise<Uint8Array> {
  if (!selector) throw new Error("Wallet not ready");
  const wallet = await selector.wallet();
  if (!("signMessage" in wallet) || typeof wallet.signMessage !== "function") throw new Error("This wallet cannot sign messages. Use Meteor.");
  const res = await wallet.signMessage({ message: walletMessage(accountId), recipient: "helm", nonce: Buffer.alloc(32) });
  if (!res?.signature) throw new Error("The wallet did not return a signature");
  return walletSeed(accountId, res.signature);
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function useNearWallet() {
  useEffect(() => { void boot(); }, []);
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  const connect = useCallback(() => modal?.show(), []);
  const disconnect = useCallback(async () => { const w = await selector?.wallet().catch(() => undefined); await w?.signOut(); }, []);
  const clearNotice = useCallback(() => set({ notice: undefined }), []);
  return { ...s, connect, disconnect, clearNotice };
}