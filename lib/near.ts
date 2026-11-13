import { PublicKey } from "@near-js/crypto";
import { actionCreators, createTransaction, encodeTransaction, Signature, SignedTransaction, type Action } from "@near-js/transactions";
import { signBytes, unbase58, type AgentKey } from "./agentKey.ts";

// Plain NEAR (testnet) access for Helm's own settlement: balances, and transactions signed by the Helm wallet
// and agent keys that live in the browser. Every movement is a real NEAR transaction you can open on NearBlocks.

export const NEAR_RPC = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];
export const EXPLORER = "https://testnet.nearblocks.io";
/** Circle's USDC on NEAR testnet (6 decimals): the token Helm settles in. */
export const USDC_CIRCLE = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
export const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR, the token's registration fee
export const TGAS = 1_000_000_000_000n;
export const NEAR = 10n ** 24n;
const b64 = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };

export async function nearRpc<T = unknown>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (const url of NEAR_RPC) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "helm", method, params }) });
      const j = await r.json();
      if (j.error) { const d = j.error.data ?? j.error.cause; throw new Error(typeof d === "string" ? d : d ? JSON.stringify(d) : j.error.message ?? "RPC error"); }
      if (j.result && typeof j.result.error === "string") throw new Error(j.result.error); // query errors arrive inside the result
      return j.result as T;
    } catch (e) {
      last = e;
      if (!(e instanceof TypeError)) break; // a real answer (not a connection problem): do not ask the next node
    }
  }
  throw last instanceof Error ? last : new Error("NEAR RPC unavailable");
}

async function view<T>(contract: string, method: string, args: object): Promise<T> {
  const r = await nearRpc<{ result: number[] }>("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

/** NEAR balance in yoctoNEAR, or null if the account does not exist yet. */
export async function nearBalance(accountId: string): Promise<bigint | null> {
  try { return BigInt((await nearRpc<{ amount: string }>("query", { request_type: "view_account", finality: "final", account_id: accountId })).amount); }
  catch (e) { if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(e instanceof Error ? e.message : e))) return null; throw e; }
}

export async function ftBalance(token: string, accountId: string): Promise<bigint> {
  return BigInt(await view<string>(token, "ft_balance_of", { account_id: accountId }));
}

export const storageDeposit = (accountId: string) =>
  actionCreators.functionCall("storage_deposit", { account_id: accountId, registration_only: true }, 30n * TGAS, STORAGE_DEPOSIT);
export const ftTransfer = (to: string, amount: bigint, memo?: string) =>
  actionCreators.functionCall("ft_transfer", { receiver_id: to, amount: amount.toString(), memo }, 30n * TGAS, 1n);

/** Sign a transaction with a browser key (exported for tests). */
export async function signTx(key: AgentKey, receiverId: string, actions: Action[], nonce: bigint, blockHash: Uint8Array): Promise<SignedTransaction> {
  const tx = createTransaction(key.accountId, PublicKey.fromString(key.publicKey), receiverId, nonce, actions, blockHash);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encodeTransaction(tx) as BufferSource));
  return new SignedTransaction({ transaction: tx, signature: new Signature({ keyType: 0, data: await signBytes(key, hash) }) });
}

// Transactions from the same key must use strictly increasing nonces. The "final" view lags a block or two, so two
// transactions sent back to back would get the same nonce and the second is rejected. Track the last nonce we used.
const lastNonce = new Map<string, bigint>();

/** Build, sign (with a browser key) and send one transaction; waits for execution and fails loudly on any failed receipt. */
export async function sendTx(key: AgentKey, receiverId: string, actions: Action[]): Promise<string> {
  const id = `${key.accountId}:${key.publicKey}`;
  for (let attempt = 0; ; attempt++) {
    const ak = await nearRpc<{ nonce: number }>("query", { request_type: "view_access_key", finality: "optimistic", account_id: key.accountId, public_key: key.publicKey })
      .catch((e) => { throw new Error(/does not exist|unknown/i.test(String(e.message)) ? `Account ${key.accountId.slice(0, 10)}… has no NEAR yet (it needs a small amount for fees)` : e.message); });
    const onChain = BigInt(ak.nonce);
    const prev = lastNonce.get(id) ?? 0n;
    const nonce = (onChain > prev ? onChain : prev) + 1n;
    const block = await nearRpc<{ header: { hash: string } }>("block", { finality: "final" });
    const signed = await signTx(key, receiverId, actions, nonce, unbase58(block.header.hash));
    lastNonce.set(id, nonce);
    try {
      return await submit(signed);
    } catch (e) {
      if (attempt < 2 && /InvalidNonce|nonce/i.test(String(e instanceof Error ? e.message : e))) { await new Promise((r) => setTimeout(r, 1200)); continue; }
      throw e;
    }
  }
}

async function submit(signed: SignedTransaction): Promise<string> {
  const res = await nearRpc<{ status: Record<string, unknown>; transaction: { hash: string }; receipts_outcome: { outcome: { status: Record<string, unknown> } }[] }>(
    "send_tx", { signed_tx_base64: b64(signed.encode()), wait_until: "EXECUTED_OPTIMISTIC" },
  );
  const failed = [res.status, ...res.receipts_outcome.map((r) => r.outcome.status)].find((s) => s && "Failure" in s);
  if (failed) throw new Error(`Transaction failed: ${JSON.stringify((failed as { Failure: unknown }).Failure).slice(0, 220)}`);
  return res.transaction.hash;
}

export const txUrl = (hash: string) => `${EXPLORER}/txns/${hash}`;
export const accountUrl = (id: string) => `${EXPLORER}/address/${id}`;