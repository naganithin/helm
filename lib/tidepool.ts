import { randomNonce, signMessage, type AgentKey } from "./agentKey.ts";
import { ASSETS, SYMBOLS, type Symbol } from "./types.ts";

// The trading venue: a 1Click-compatible NEAR Intents API (Tidepool sandbox).
// https://www.usetidepool.tech/llms-full.txt  (CORS is open, so the browser calls it directly)
export const BASE = "https://www.usetidepool.tech";
const VERIFIER = "verifier.tidepool-sandbox.testnet";

export const USDC = "nep141:usdc.tidepool-sandbox.testnet";
/** Helm symbols that have a Tidepool testnet token (derived from the asset registry). */
export const TRADABLE = Object.fromEntries(SYMBOLS.map((s) => [s, ASSETS[s].tp])) as Record<Symbol, string>;
export type TradableSymbol = Symbol;
export const isTradable = (s: string): s is Symbol => s in TRADABLE;
export const FAUCET_URL = "https://app.usetidepool.tech/faucet";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(json.message ?? `Tidepool ${path}: HTTP ${res.status}`);
  return json as T;
}
const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

export interface TokenInfo { assetId: string; decimals: number; price: number; symbol: string; blockchain: string }
let tokenCache: Promise<Map<string, TokenInfo>> | undefined;
export function tokens(): Promise<Map<string, TokenInfo>> {
  tokenCache ??= api<TokenInfo[]>("/v0/tokens?ondoTokens=1")
    .then((list) => new Map(list.map((t) => [t.assetId, t])))
    .catch((e) => {
      tokenCache = undefined;
      throw e;
    });
  return tokenCache;
}
export async function decimalsOf(assetId: string): Promise<number> {
  const t = (await tokens()).get(assetId);
  if (!t) throw new Error(`Tidepool does not list ${assetId} right now`);
  return t.decimals;
}

const jwt = new Map<string, { token: string; exp: number }>();
async function authenticate(key: AgentKey): Promise<string> {
  const hit = jwt.get(key.accountId);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const payload = JSON.stringify({
    signer_id: key.accountId,
    verifying_contract: VERIFIER,
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    nonce: randomNonce(),
    intents: [],
  });
  const r = await post<{ accessToken: string; expiresIn: number }>("/v0/auth/authenticate", {
    signedData: { standard: "raw_ed25519", payload, public_key: key.publicKey, signature: await signMessage(key, payload) },
  });
  jwt.set(key.accountId, { token: r.accessToken, exp: Date.now() + r.expiresIn * 1000 });
  return r.accessToken;
}

/** Intents balances (base units) of the agent's account. */
export async function balances(key: AgentKey, assetIds: string[]): Promise<Record<string, bigint>> {
  const token = await authenticate(key);
  const r = await api<{ balances: { tokenId: string; available: string }[] }>(
    `/v0/account/balances?tokenIds=${encodeURIComponent(assetIds.join(","))}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return Object.fromEntries(r.balances.map((b) => [b.tokenId, BigInt(b.available)]));
}

export interface SwapResult { amountOut: bigint; txRef: string }

/**
 * Swap inside Intents: quote -> sign a transfer to the quote's deposit address with `key` ->
 * poll until SUCCESS. The output is delivered to `recipient` (another Intents account), which is how
 * the vault funds an agent and how an agent returns proceeds to the vault. REFUNDED / FAILED become errors; the input
 * is refunded to the same account by Tidepool, so no funds are lost.
 */
export async function swap(key: AgentKey, from: string, to: string, amountIn: bigint, recipient: string = key.accountId): Promise<SwapResult> {
  const quote = await post<{ quote: { depositAddress: string; amountOut: string } }>("/v0/quote", {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: from,
    depositType: "INTENTS",
    destinationAsset: to,
    amount: amountIn.toString(),
    refundTo: key.accountId,
    refundType: "INTENTS",
    recipient,
    recipientType: "INTENTS",
    deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  const depositAddress = quote.quote.depositAddress;
  const gen = await post<{ intent: { payload: string } }>("/v0/generate-intent", {
    type: "swap_transfer",
    standard: "raw_ed25519",
    signerId: key.accountId,
    depositAddress,
  });
  const payload = gen.intent.payload;
  const submitted = await post<{ intentHash: string }>("/v0/submit-intent", {
    type: "swap_transfer",
    signedData: { standard: "raw_ed25519", payload, public_key: key.publicKey, signature: await signMessage(key, payload) },
  });

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await api<{ status: string; swapDetails?: { amountOut?: string; refundReason?: string } }>(
      `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
    );
    if (st.status === "SUCCESS") return { amountOut: BigInt(st.swapDetails?.amountOut ?? quote.quote.amountOut), txRef: submitted.intentHash };
    if (st.status === "REFUNDED" || st.status === "FAILED")
      throw new Error(`Swap ${st.status}${st.swapDetails?.refundReason ? ` (${st.swapDetails.refundReason})` : ""}`);
  }
  throw new Error("Swap still processing after 150 s; funds stay in the agent account");
}

export interface DepositQuote { depositAddress: string; amountIn: string; amountOut: string; amountOutFormatted: string; deadline: string }

/**
 * Bridge-in quote: the user sends `amount` of a test token from another chain to `depositAddress`,
 * and Tidepool credits USDC to `recipient` (the wallet vault) inside Intents.
 */
export async function depositQuote(originAsset: string, amountBase: bigint, refundTo: string, recipient: string): Promise<DepositQuote> {
  const r = await post<{ quote: DepositQuote }>("/v0/quote", {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: USDC,
    amount: amountBase.toString(),
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "INTENTS",
    deadline: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  });
  return r.quote;
}

/** Progress of a deposit/swap by its deposit address (PENDING_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, ...). */
export async function depositStatus(depositAddress: string): Promise<string> {
  return (await api<{ status: string }>(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`)).status;
}

export const WNEAR = TRADABLE.NEAR;

/** Networks a user can fund the Helm wallet from, with their USDC token on that network. */
export const DEPOSIT_NETWORKS: Record<string, string> = {
  base: "Base", arb: "Arbitrum", eth: "Ethereum", bsc: "BNB Chain", aurora: "Aurora", sol: "Solana", sui: "Sui",
};

export interface NetworkAddress { address: string; deadline: string; assetId: string }

/**
 * A deposit address on another network that accepts any amount of USDC and credits it to `recipient`
 * (the Helm wallet). Refunds also go back to the Helm wallet, so no user address is needed. The venue
 * keeps an address alive for up to 24 hours; Helm stores it and reuses it until it is about to expire.
 */
export async function networkAddress(chain: string, recipient: string): Promise<NetworkAddress> {
  const origin = [...(await tokens()).values()].find((t) => t.blockchain === chain && t.symbol === "USDC" && t.assetId.includes("tp-omft"));
  if (!origin) throw new Error(`USDC on ${DEPOSIT_NETWORKS[chain] ?? chain} is not available right now`);
  const r = await post<{ quote: { depositAddress: string; deadline: string } }>("/v0/quote", {
    dry: false, swapType: "ANY_INPUT", slippageTolerance: 100, originAsset: origin.assetId, depositType: "ORIGIN_CHAIN",
    destinationAsset: USDC, amount: "1000000", refundTo: recipient, refundType: "INTENTS", recipient, recipientType: "INTENTS",
    deadline: new Date(Date.now() + 23 * 3_600_000).toISOString(),
  });
  return { address: r.quote.depositAddress, deadline: r.quote.deadline, assetId: origin.assetId };
}