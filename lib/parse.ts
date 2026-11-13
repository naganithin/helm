import { z } from "zod";
import { assetInfo, SYMBOLS } from "./types.ts";
import type { Intent, Symbol } from "./types.ts";

/** Shape the LLM must return. Percentages are plain numbers (60 = 60%). */
export const llmIntentSchema = z.object({
  capitalUsd: z.number().positive(),
  allocations: z.record(z.string(), z.number().min(0).max(100)),
  targetRoiPct: z.number(),
  horizonDays: z.number().int().min(1).max(730),
  stopLossPct: z.number().min(0).max(100).nullable().optional(),
  note: z.string().max(400).nullable().optional(),
  advised: z.boolean().nullable().optional(),
});

export const TRADABLE_HINT = SYMBOLS.map((s) => `${s} (${assetInfo(s).name})`).join(", ");

export function toIntent(raw: unknown, prompt: string): Intent {
  const p = llmIntentSchema.parse(raw);
  const weights: Partial<Record<Symbol, number>> = {};
  for (const [k, v] of Object.entries(p.allocations)) {
    const sym = k.toUpperCase() as Symbol;
    if (v <= 0) continue;
    if (!SYMBOLS.includes(sym)) throw new Error(`${k.toUpperCase()} can't be traded on NEAR testnet (Tidepool). Tradable assets: ${TRADABLE_HINT}.`);
    weights[sym] = v / 100;
  }
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  if (total === 0) throw new Error("No allocation found");
  if (total > 1.0001) throw new Error(`Allocations add up to ${(total * 100).toFixed(0)}%, must be at most 100%`);
  return {
    capitalUsd: p.capitalUsd,
    weights,
    targetRoi: p.targetRoiPct / 100,
    horizonDays: p.horizonDays,
    stopLoss: p.stopLossPct ? p.stopLossPct / 100 : null,
    prompt,
    rationale: p.note?.trim() || undefined,
    advised: p.advised === true ? true : undefined,
  };
}

/** Tickers people ask for that exist elsewhere but not on Tidepool: recognised so we can say why not. */
const OTHER = "DOGE|SOL|XRP|BNB|AVAX|LINK|ARB|ADA|DOT|MATIC|POL|LTC|SHIB|TON|TRX|ATOM|UNI|PEPE|SUI|APT";
const NAMES: Record<string, string> = {
  bitcoin: "BTC", ethereum: "ETH", ether: "ETH", gold: "XAUT", silver: "SLV", apple: "AAPL", tesla: "TSLA", nvidia: "NVDA", microsoft: "MSFT", google: "GOOGL", alphabet: "GOOGL", amazon: "AMZN", bonds: "AGG", treasuries: "TLT", "s&p": "SPY", nasdaq: "QQQ", solana: "SOL", ripple: "XRP", dogecoin: "DOGE",
  avalanche: "AVAX", chainlink: "LINK", arbitrum: "ARB", binance: "BNB",
};
const SYM = `${SYMBOLS.join("|")}|${OTHER}|${Object.keys(NAMES).map((k) => k.replace("&", "\\&")).join("|")}`;
const toSym = (s: string) => NAMES[s.toLowerCase()] ?? s.toUpperCase();
const num = "(\\d+(?:\\.\\d+)?)";

interface Found {
  capitalUsd?: number;
  allocations?: Record<string, number>;
  targetRoiPct?: number;
  horizonDays?: number;
  stopLossPct?: number | null; // null = explicitly removed
  /** the goal / stop were given as money ("target 12 USDC", "stop at 9"), not as a percentage */
  fromAmount?: { target?: boolean; stop?: boolean };
}

type Raw = { value: number; unit: "%" | "usd" | "none" };

/** "target - 12 USDC", "stop at $9", "stop loss 8%": the number after a label, with its unit if any. The matched text is cut out. */
function phrase(text: string, label: string): { raw?: Raw; rest: string } {
  const m = new RegExp(`(?:${label})\\s*(?:of|at|to|below|under|=|:|-|is)?\\s*(\\$)?\\s*${num}\\s*(%|usdc|usd|dollars?)?`, "i").exec(text);
  if (!m) return { rest: text };
  const unit = m[3] ? (m[3] === "%" ? "%" : "usd") : m[1] ? "usd" : "none";
  return { raw: { value: Number(m[2]), unit }, rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}` };
}

/**
 * Turn a goal or stop into a percentage of the starting amount. Money is converted against the capital
 * ("target 12 USDC" on 10 USDC is +20%, "stop at 9" is -10%). A bare number is money only when it sits
 * in the range a money value could (a target above the capital, a stop between half and all of it).
 */
function toPct(raw: Raw, kind: "target" | "stop", capital?: number): { pct: number; amount: boolean } {
  if (raw.unit === "%") return { pct: raw.value, amount: false };
  const looksLikeMoney = capital != null && (kind === "target" ? raw.value > capital && raw.value <= capital * 3 : raw.value > capital * 0.5 && raw.value < capital);
  if (raw.unit === "none" && !looksLikeMoney) return { pct: raw.value, amount: false };
  if (capital == null) throw new Error("Tell me your amount too, so I can turn dollars into a percentage");
  if (kind === "target") {
    if (raw.value <= capital) throw new Error(`A target of ${raw.value} is not above your ${capital}. Use a number higher than your amount, or a percentage like 20%`);
    return { pct: (raw.value / capital - 1) * 100, amount: true };
  }
  if (raw.value >= capital) throw new Error(`A stop at ${raw.value} must be below your ${capital}`);
  return { pct: (1 - raw.value / capital) * 100, amount: true };
}

/** Pull whatever parameters the text mentions. Shared by the first parse and by edits. `capitalHint` is the amount the strategy already has. */
function extract(prompt: string, capitalHint?: number): Found {
  const out: Found = {};
  // goal and stop first, and cut out of the text, so "12 USDC" is not mistaken for the amount or a percentage
  const t = phrase(prompt.replace(/,/g, " "), "target|goal|aim(?:ing)?(?:\\s+for)?|reach|get(?:ting)?\\s+to");
  const s = phrase(t.rest, "stop(?:[\\s-]*loss)?|exit(?:\\s+at)?");
  const text = s.rest;

  const allocations: Record<string, number> = {};
  const re1 = new RegExp(`${num}\\s*%\\s*(?:of\\s+it\\s+)?(?:into|in|to|on|for)?\\s*(${SYM})\\b`, "gi");
  const re2 = new RegExp(`\\b(${SYM})\\s*(?:at|to|:|=)?\\s*${num}\\s*%`, "gi");
  for (const m of text.matchAll(re1)) allocations[toSym(m[2])] = (allocations[toSym(m[2])] ?? 0) + Number(m[1]);
  if (!Object.keys(allocations).length) for (const m of text.matchAll(re2)) allocations[toSym(m[1])] = (allocations[toSym(m[1])] ?? 0) + Number(m[2]);
  if (Object.keys(allocations).length) out.allocations = allocations;

  const cap = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(k|m)?|(\d+(?:\.\d+)?)\s*(k|m)?\s*(?:\$|usd|usdc|dollars)/i);
  if (cap) {
    const u = (cap[2] ?? cap[4] ?? "").toLowerCase();
    out.capitalUsd = Number(cap[1] ?? cap[3]) * (u === "k" ? 1e3 : u === "m" ? 1e6 : 1);
  }
  const capital = out.capitalUsd ?? capitalHint;

  if (s.raw) {
    const r = toPct(s.raw, "stop", capital);
    out.stopLossPct = r.pct;
    if (r.amount) out.fromAmount = { ...out.fromAmount, stop: true };
  } else {
    const sl = text.match(new RegExp(`${num}\\s*%\\s*stop[\\s-]*loss`, "i"));
    if (sl) out.stopLossPct = Number(sl[1]);
    else if (/(no|remove|without|drop|disable)\s+(the\s+)?stop[\s-]*loss/i.test(text)) out.stopLossPct = null;
  }

  const roi = text.match(new RegExp(`${num}\\s*%\\s*(?:roi|return|profit|gain)|(?:roi|return|profit|gain)\\s*(?:of|at|to|=|:)?\\s*${num}\\s*%`, "i"));
  // also "4% in a month", "10% over 6 weeks" (a percentage followed by a duration, not an asset)
  const bare = text.match(new RegExp(`${num}\\s*%\\s*(?:in|over|within)\\s+(?:a|an|\\d+(?:\\.\\d+)?)\\s*(?:day|week|month|year)`, "i"));
  if (t.raw) {
    const r = toPct(t.raw, "target", capital);
    out.targetRoiPct = r.pct;
    if (r.amount) out.fromAmount = { ...out.fromAmount, target: true };
  } else if (roi) out.targetRoiPct = Number(roi[1] ?? roi[2]);
  else if (bare) out.targetRoiPct = Number(bare[1]);

  const dur = text.match(new RegExp(`${num}\\s*(day|week|month|year)s?`, "i"));
  if (dur) out.horizonDays = Math.round(Number(dur[1]) * { day: 1, week: 7, month: 30, year: 365 }[dur[2].toLowerCase() as "day"]);
  return out;
}

/** Goal / stop the user gave as money. Used to override an AI reading, which tends to mistake dollars for percent. */
export function amountOverrides(text: string, capital: number): { targetRoiPct?: number; stopLossPct?: number } {
  const f = extract(text, capital);
  return { ...(f.fromAmount?.target ? { targetRoiPct: f.targetRoiPct } : {}), ...(f.fromAmount?.stop ? { stopLossPct: f.stopLossPct ?? undefined } : {}) };
}
const DEFENSIVE: Record<string, number> = { SGOV: 30, AGG: 25, SPY: 20, TLT: 10, GLD: 10 };
const GROWTH: Record<string, number> = { BTC: 20, ETH: 10, NEAR: 10, NVDA: 20, TSLA: 10, QQQ: 20 };
const BALANCED: Record<string, number> = { SPY: 35, BTC: 20, AGG: 20, GLD: 15, ETH: 10 };
const STARTER_NOTE = "The AI advisor was not available, so Helm started you with a built-in mix. Use Compare options to test safer and riskier alternatives.";

/** Assets the text names without giving percentages ("gold and the S&P 500", "BTC and AAPL"). */
function mentioned(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(new RegExp(`\\b(${SYMBOLS.join("|")}|${OTHER})\\b`, "g"))) found.add(m[1]);
  const names = Object.keys(NAMES).map((k) => k.replace("&", "\\&")).join("|");
  for (const m of text.matchAll(new RegExp(`\\b(${names})(?![a-z])`, "gi"))) found.add(toSym(m[1]));
  return [...found];
}

/** Deterministic parser used when every LLM is unavailable or returns something invalid. */
export function parseWithRules(prompt: string): Intent {
  const f = extract(prompt);
  if (!f.capitalUsd) throw new Error("Could not find an amount (e.g. '$10k')");
  if (f.allocations) {
    // weights given, goal and/or time not: assume 10% in 30 days and say so, rather than refuse
    const assumed = [f.targetRoiPct == null ? "a 10% goal" : "", !f.horizonDays ? "30 days" : ""].filter(Boolean).join(" over ");
    return toIntent({ ...f, targetRoiPct: f.targetRoiPct ?? 10, horizonDays: f.horizonDays ?? 30, stopLossPct: f.stopLossPct ?? null, note: assumed ? `You did not give a ${f.targetRoiPct == null && !f.horizonDays ? "goal or a time" : f.targetRoiPct == null ? "goal" : "time"}, so I assumed ${assumed}. Change it in words below if you like.` : undefined }, prompt);
  }  const named = mentioned(prompt);
  const base = { capitalUsd: f.capitalUsd, targetRoiPct: f.targetRoiPct ?? 10, horizonDays: f.horizonDays ?? 30, stopLossPct: f.stopLossPct ?? null };
  if (named.length) {
    // the user chose the assets but not the split: divide evenly (toIntent rejects anything not tradable)
    const each = Math.floor(100 / named.length);
    return toIntent({ ...base, allocations: Object.fromEntries(named.map((s) => [s, each])), note: `Split evenly between what you named. ${f.targetRoiPct == null || !f.horizonDays ? "Goal and time were not given, so 10% in 30 days was assumed." : ""}`.trim() }, prompt);
  }
  // vague request: a starting mix by stated risk appetite; the Compare options panel opens for it
  const mix = /\b(safe|safest|conservative|steady|low[- ]risk|defensive|cautious)\b/i.test(prompt) ? DEFENSIVE : /\b(aggressive|high[- ]risk|growth|max|maximum|best returns?|highest)\b/i.test(prompt) ? GROWTH : BALANCED;
  return { ...toIntent({ ...base, allocations: mix, note: STARTER_NOTE }, prompt), advised: true };
}
/** Rule-based edit of an existing strategy ("stop loss to 15%", "more ETH: 40%", "no stop loss"). */
export function refineWithRules(current: Intent, instruction: string): Intent {
  const f = extract(instruction, current.capitalUsd);
  if (!/\b(capital|invest(?:ing|ment)?|amount|budget|deposit|put in|have)\b/i.test(instruction)) delete f.capitalUsd; // a bare "12 USDC" in an edit is a goal, not a new amount
  if (!Object.keys(f).length) throw new Error("Could not tell what to change. Try 'stop loss 15%', 'target 20% in 30 days' or 'ETH 40%'.");
  const weights = { ...Object.fromEntries(Object.entries(current.weights).map(([k, v]) => [k, v! * 100])), ...f.allocations };
  return toIntent(
    {
      capitalUsd: f.capitalUsd ?? current.capitalUsd,
      allocations: weights,
      targetRoiPct: f.targetRoiPct ?? current.targetRoi * 100,
      horizonDays: f.horizonDays ?? current.horizonDays,
      stopLossPct: f.stopLossPct === undefined ? (current.stopLoss != null ? current.stopLoss * 100 : null) : f.stopLossPct,
      note: current.rationale,
    },
    `${current.prompt} | edit: ${instruction}`,
  );
}
