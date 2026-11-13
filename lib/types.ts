import type { AgentKey } from "./agentKey.ts";

export type AssetKind = "crypto" | "commodity" | "stock" | "etf" | "bond";
export const KIND_LABEL: Record<AssetKind, string> = {
  crypto: "Crypto", commodity: "Gold & metals", stock: "Tokenized stocks", etf: "Index funds (ETFs)", bond: "Bonds & T-bills",
};
export type Network = "NEAR";

interface AssetDef {
  name: string;
  kind: AssetKind;
  /** where the real price history comes from */
  hist: { binance: string } | { yahoo: string };
  /** the Tidepool testnet token this asset trades as */
  tp: string;
  /** the chain the token lives on */
  network: Network;
  /** one plain sentence for non-experts */
  blurb: string;
}
const near = (id: string) => `nep141:${id}.tidepool-sandbox.testnet`;
// Tokenized securities (Ondo) are bridged into NEAR Intents and traded there like the rest.
const ondo = (addr: string) => `nep141:bnb-${addr}.tp-omdep.testnet`;

/** Everything Helm agents can actually buy on Tidepool testnet. Add a row here and it flows through parsing, projection and execution. */
export const ASSETS = {
  BTC: { name: "Bitcoin", kind: "crypto", hist: { binance: "BTCUSDT" }, tp: near("wbtc"), network: "NEAR", blurb: "The largest crypto. Moves a lot, but is the most established." },
  ETH: { name: "Ethereum", kind: "crypto", hist: { binance: "ETHUSDT" }, tp: near("eth"), network: "NEAR", blurb: "The second-largest crypto. Usually swings more than Bitcoin." },
  NEAR: { name: "NEAR", kind: "crypto", hist: { binance: "NEARUSDT" }, tp: near("wnear"), network: "NEAR", blurb: "Smaller crypto: bigger possible gains and bigger possible losses." },
  // gold history uses PAXG: XAUT only listed in 2026, PAXG tracks the same gold price since 2020
  XAUT: { name: "Tether Gold", kind: "commodity", hist: { binance: "PAXGUSDT" }, tp: near("xaut"), network: "NEAR", blurb: "A token backed by physical gold. Tends to hold up when markets fall." },
  GLD: { name: "Gold ETF (SPDR)", kind: "commodity", hist: { yahoo: "GLD" }, tp: ondo("0x2e6fb6681da659ef1cff5c7794e110e3c2cb622b"), network: "NEAR", blurb: "Tracks the price of gold." },
  SLV: { name: "Silver ETF (iShares)", kind: "commodity", hist: { yahoo: "SLV" }, tp: ondo("0xf2bc8c6df2503728fafa9d1a16e35fbe5ba95355"), network: "NEAR", blurb: "Tracks the price of silver." },
  SPY: { name: "S&P 500 (SPDR)", kind: "etf", hist: { yahoo: "SPY" }, tp: ondo("0x3098cf9515a080c980cb1c1695618d6fbff5ae28"), network: "NEAR", blurb: "The 500 biggest US companies in one asset." },
  QQQ: { name: "Nasdaq 100 (Invesco)", kind: "etf", hist: { yahoo: "QQQ" }, tp: ondo("0xe7a7265a1593389d40d9e7f6b449f9fb7e3ec76d"), network: "NEAR", blurb: "The 100 biggest US tech-leaning companies." },
  AAPL: { name: "Apple", kind: "stock", hist: { yahoo: "AAPL" }, tp: ondo("0xd9db27b0d3d409886cd211e0120bcdec01cb41ea"), network: "NEAR", blurb: "Share in Apple." },
  MSFT: { name: "Microsoft", kind: "stock", hist: { yahoo: "MSFT" }, tp: ondo("0x69b1e7a4771ea6f507a3ce617f57a302e64cbe00"), network: "NEAR", blurb: "Share in Microsoft." },
  NVDA: { name: "NVIDIA", kind: "stock", hist: { yahoo: "NVDA" }, tp: ondo("0x4ca1ebd3b2bdfd8cbec672fb62a61c94dab5f5c6"), network: "NEAR", blurb: "Share in NVIDIA, the AI chip maker." },
  TSLA: { name: "Tesla", kind: "stock", hist: { yahoo: "TSLA" }, tp: ondo("0xeca4e85baad4b128c20e4cf11cfa085836693b10"), network: "NEAR", blurb: "Share in Tesla. Volatile." },
  GOOGL: { name: "Alphabet (Google)", kind: "stock", hist: { yahoo: "GOOGL" }, tp: ondo("0xf0d1859e775f2f36ba8a8baf388d7bf573965c8e"), network: "NEAR", blurb: "Share in Google's parent company." },
  AMZN: { name: "Amazon", kind: "stock", hist: { yahoo: "AMZN" }, tp: ondo("0xb058119e397ab45d74625369535135600af57c64"), network: "NEAR", blurb: "Share in Amazon." },
  META: { name: "Meta", kind: "stock", hist: { yahoo: "META" }, tp: ondo("0x12dda41e4d2136a77aa4938a7af6e1e0cceb840a"), network: "NEAR", blurb: "Share in Meta (Facebook, Instagram)." },
  TLT: { name: "20+ yr US Treasuries", kind: "bond", hist: { yahoo: "TLT" }, tp: ondo("0x1b8ca4760db055e35df5e9ca3915c0b46500bb48"), network: "NEAR", blurb: "Long-term US government bonds. Can offset stock drops, but fall when rates rise." },
  AGG: { name: "US Bonds (broad)", kind: "bond", hist: { yahoo: "AGG" }, tp: ondo("0x76068de1e7ea0bf11104ccc952724e54010e5d42"), network: "NEAR", blurb: "A broad mix of US bonds. Calm and steady." },
  SGOV: { name: "0-3 mo US T-bills", kind: "bond", hist: { yahoo: "SGOV" }, tp: ondo("0x992ed2d86f5a9312e0c12c63ef44a415851dbcbe"), network: "NEAR", blurb: "Very short government bills: the closest thing to a savings account here." },
} as const satisfies Record<string, AssetDef>;
export type Symbol = keyof typeof ASSETS;
export const SYMBOLS = Object.keys(ASSETS) as Symbol[];
export const assetInfo = (s: string): AssetDef => (ASSETS as Record<string, AssetDef>)[s];
/** Unallocated weight is held in this stable asset (zero volatility). */
export const CASH = "USDC";

/** Daily closes per symbol, aligned on the same dates (oldest first). */
export interface MarketData {
  source: "snapshot" | "live";
  asOf: string;
  dates: string[];
  closes: Partial<Record<Symbol, number[]>>;
}

export interface Intent {
  capitalUsd: number;
  weights: Partial<Record<Symbol, number>>; // fractions, sum <= 1
  targetRoi: number; // fraction, e.g. 0.1
  horizonDays: number;
  stopLoss: number | null; // fraction of capital, e.g. 0.1 = exit at -10%
  prompt: string;
  /** AI note: why these weights, and any warning about the target. */
  rationale?: string;
  /** true when the AI chose the weights because the user did not (a vague request) */
  advised?: boolean;
}

export interface AssetStats {
  symbol: Symbol;
  weight: number;
  annReturn: number;
  annVol: number;
  sharpe: number;
  maxDrawdown: number;
  last: number;
}

export interface Projection {
  paths: number;
  horizonDays: number;
  /** percentile fans, index = day (0..horizonDays), values in USD */
  fan: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  expectedRoi: number;
  medianRoi: number;
  probTarget: number;
  probLoss: number;
  probStop: number;
  var95: number; // loss fraction at 5th percentile (positive = loss)
  cvar95: number;
  medianMaxDrawdown: number;
  portfolioVol: number; // annualised
  assets: AssetStats[];
  symbols: Symbol[];
  correlation: number[][];
  /** chance of reaching a range of goals with this same mix (plain-language "what each goal costs") */
  ladder: { roi: number; prob: number }[];
  historyDays: number;
  historyFrom: string;
  historyTo: string;
  /** "neutral": past average returns removed (no trend assumed). "history": the past trend repeats. */
  drift: "neutral" | "history";
}

export type AgentStatus = "draft" | "active" | "stopped" | "closed";

export interface AgentEvent {
  t: number;
  kind: "created" | "executed" | "tick" | "stop-loss" | "closed" | "error";
  message: string;
  txRef?: string;
}

export interface Strategy {
  id: string;
  name: string;
  intent: Intent;
  projection: Projection;
  status: AgentStatus;
  /** units held per symbol after execution */
  units: Partial<Record<Symbol, number>>;
  /** live only: this strategy's own Tidepool account + key (testnet) */
  agent?: AgentKey;
  /** USDC held (unallocated weight, then all proceeds after an exit) */
  cash: number;
  executedAt?: number;
  entryValue: number;
  exitValue?: number;
  events: AgentEvent[];
  createdAt: number;
}
