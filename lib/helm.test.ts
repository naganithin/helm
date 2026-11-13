import { describe, expect, it } from "vitest";
import snapshot from "../data/snapshot.json";
import { compareOptions } from "./advisor";
import { wordsToDigits } from "./numbers";
import { allocation, decide, portfolioValue } from "./agent";
import { agentKeyFromSeed, base58, newAgentKey, signMessage, walletSeed } from "./agentKey";
import { simulatedExecutor } from "./executor";
import { project } from "./montecarlo";
import { parseWithRules, refineWithRules } from "./parse";
import { assetInfo, SYMBOLS, type Intent, type MarketData, type Strategy } from "./types";

const data = snapshot as unknown as MarketData;
const ctx = { free: Infinity };
const intent: Intent = {
  capitalUsd: 10_000,
  weights: { BTC: 0.6, ETH: 0.3, NEAR: 0.1 },
  targetRoi: 0.1,
  horizonDays: 60,
  stopLoss: null,
  prompt: "",
};

describe("parser", () => {
  it("parses the headline prompt", () => {
    const i = parseWithRules("I have 10k$. I want to diversify 60% into BTC, 30% ETH, 10% NEAR. I'm looking for 10% ROI in 2 months, stop loss 10%");
    expect(i.capitalUsd).toBe(10_000);
    expect(i.weights).toEqual({ BTC: 0.6, ETH: 0.3, NEAR: 0.1 });
    expect(i.targetRoi).toBeCloseTo(0.1);
    expect(i.horizonDays).toBe(60);
    expect(i.stopLoss).toBeCloseTo(0.1);
  });
  it("rejects allocations over 100%", () => {
    expect(() => parseWithRules("$1000 70% BTC 50% ETH 5% ROI in 1 month")).toThrow(/at most 100/);
  });
});

describe("tradable assets and edits", () => {
  it("rejects assets Tidepool cannot trade and says what is tradable", () => {
    expect(() => parseWithRules("$10 100% DOGE 30% ROI in 2 days")).toThrow(/DOGE can.t be traded.*BTC.*ETH.*NEAR.*XAUT/);
  });
  it("understands gold", () => {
    expect(parseWithRules("$1000 50% gold 50% BTC 5% ROI in 1 month").weights).toEqual({ XAUT: 0.5, BTC: 0.5 });
  });
  it("edits one parameter and keeps the rest", () => {
    const base = parseWithRules("$10k 60% BTC 30% ETH 10% NEAR 10% ROI in 2 months stop loss 10%");
    const a = refineWithRules(base, "change the stop loss to 15%");
    expect(a.stopLoss).toBeCloseTo(0.15);
    expect(a.weights).toEqual(base.weights);
    expect(a.horizonDays).toBe(60);
    expect(refineWithRules(base, "remove the stop loss").stopLoss).toBeNull();
    const b = refineWithRules({ ...base, weights: { BTC: 0.6, ETH: 0.3, NEAR: 0.1 } }, "NEAR 0%");
    expect(b.weights).toEqual({ BTC: 0.6, ETH: 0.3 });
    expect(() => refineWithRules(base, "hello")).toThrow(/what to change/);
    expect(() => refineWithRules(base, "ETH to 80%")).toThrow(/at most 100/);
  });
});

describe("wider asset universe", () => {
  it("knows stocks, ETFs, bonds and their networks", () => {
    const i = parseWithRules("$1000 40% apple 30% SPY 30% TLT 5% ROI in 3 months");
    expect(i.weights).toEqual({ AAPL: 0.4, SPY: 0.3, TLT: 0.3 });
    expect(assetInfo("AAPL").network).toBe("NEAR");
    expect(assetInfo("BTC").network).toBe("NEAR");
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(18);
  });
  it("the bundled history covers every asset on one calendar", () => {
    for (const s of SYMBOLS) expect(data.closes[s]).toHaveLength(data.dates.length);
  });
  it("drift-neutral projection does not project the past trend forward", () => {
    const btc: Intent = { ...intent, weights: { BTC: 1 }, horizonDays: 90 };
    const neutral = project(data, btc, { paths: 3000, seed: 5, drift: "neutral" });
    const hist = project(data, btc, { paths: 3000, seed: 5, drift: "history" });
    expect(neutral.drift).toBe("neutral");
    expect(Math.abs(neutral.medianRoi)).toBeLessThan(Math.abs(hist.medianRoi));
    expect(neutral.historyFrom < neutral.historyTo).toBe(true);
  });
});

describe("numbers written as words", () => {
  it("become digits", () => {
    expect(wordsToDigits("five hundred dollars for six months")).toBe("500 dollars for 6 months");
    expect(wordsToDigits("two thousand five hundred and fifty")).toBe("2550");
    expect(wordsToDigits("sixty-five percent in twenty days")).toBe("65 percent in 20 days");
  });
  it("an amount in words is parsed like digits, and weights without a goal get sensible defaults", () => {
    const i = parseWithRules(wordsToDigits("create a strategy for ten USDC with 60% to BTC and 40% ETH"));
    expect(i.capitalUsd).toBe(10);
    expect(i.weights).toEqual({ BTC: 0.6, ETH: 0.4 });
    expect(i.targetRoi).toBeCloseTo(0.1);
    expect(i.horizonDays).toBe(30);
  });
});

describe("goals and stops given as money", () => {
  const base = parseWithRules("$10 60% BTC 40% ETH 5% ROI in 30 days");
  it("target 12 USDC / stop at 9 on 10 USDC means +20% and -10%, not 12% and 9%", () => {
    const a = refineWithRules(base, "target - 12 USDC, Stop at 9");
    expect(a.targetRoi).toBeCloseTo(0.2);
    expect(a.stopLoss).toBeCloseTo(0.1);
    expect(a.capitalUsd).toBe(10); // 12 USDC is a goal, not a new amount
  });
  it("explicit units always win", () => {
    expect(refineWithRules(base, "target 12%").targetRoi).toBeCloseTo(0.12);
    expect(refineWithRules(base, "stop loss 9%").stopLoss).toBeCloseTo(0.09);
    expect(refineWithRules(base, "target $15").targetRoi).toBeCloseTo(0.5);
    expect(refineWithRules(base, "stop at $8.5").stopLoss).toBeCloseTo(0.15);
  });
  it("a bare number far from the amount stays a percentage", () => {
    const big = parseWithRules("$10000 60% BTC 40% ETH 5% ROI in 30 days");
    expect(refineWithRules(big, "target 15, stop at 8").targetRoi).toBeCloseTo(0.15);
    expect(refineWithRules(big, "target 15, stop at 8").stopLoss).toBeCloseTo(0.08);
    expect(refineWithRules(big, "stop at 9500").stopLoss).toBeCloseTo(0.05);
  });
  it("rejects impossible money levels with a clear message", () => {
    expect(() => refineWithRules(base, "stop at $12")).toThrow(/must be below/);
    expect(() => refineWithRules(base, "target $10 USDC")).toThrow(/not above/);
  });
  it("works in a first prompt too", () => {
    const i = parseWithRules("I have 10 USDC, 50% BTC 50% ETH, target 12 USDC in 2 weeks, stop at 9 USDC");
    expect(i.capitalUsd).toBe(10);
    expect(i.targetRoi).toBeCloseTo(0.2);
    expect(i.stopLoss).toBeCloseTo(0.1);
    expect(i.horizonDays).toBe(14);
  });
});

describe("offline fallback (AI unavailable)", () => {
  it("splits evenly between assets the user names", () => {
    const i = parseWithRules("$2k between gold and the S&P 500, 4% in a month, stop loss 5%");
    expect(i.weights).toEqual({ XAUT: 0.5, SPY: 0.5 });
    expect(i.targetRoi).toBeCloseTo(0.04);
    expect(i.horizonDays).toBe(30);
    expect(i.stopLoss).toBeCloseTo(0.05);
  });
  it("does not mistake the word near for NEAR", () => {
    expect(parseWithRules("$500 BTC and ETH, near term, 5% in 2 weeks").weights).toEqual({ BTC: 0.5, ETH: 0.5 });
  });
  it("still refuses assets that cannot be traded, even without percentages", () => {
    expect(() => parseWithRules("$100 in DOGE and BTC")).toThrow(/DOGE can.t be traded/);
  });
  it("gives a vague request a starting mix by risk appetite and flags it as advised", () => {
    const safe = parseWithRules("I have $500, safe and steady");
    const bold = parseWithRules("$500 give me the best returns");
    expect(safe.advised).toBe(true);
    expect(bold.advised).toBe(true);
    expect(safe.weights.SGOV).toBeGreaterThan(0);
    expect(bold.weights.SGOV).toBeUndefined();
    expect(Object.values(safe.weights).reduce((a, b) => a + b!, 0)).toBeLessThanOrEqual(1);
    expect(() => parseWithRules("best returns please")).toThrow(/amount/);
  });
});

describe("goal ladder and option picker", () => {
  it("bigger goals are never more likely", () => {
    const p = project(data, { ...intent, horizonDays: 30 }, { paths: 2000, seed: 2 });
    for (let k = 1; k < p.ladder.length; k++) expect(p.ladder[k].prob).toBeLessThanOrEqual(p.ladder[k - 1].prob);
    expect(p.ladder.some((g) => Math.abs(g.roi - intent.targetRoi) < 1e-9)).toBe(true);
  });
  it("offers safe, balanced and goal-focused mixes that really trade off", async () => {
    const [safe, balanced, gain] = await compareOptions(data, { capitalUsd: 10, horizonDays: 30, targetRoi: 0.1, stopLoss: null });
    expect([safe.id, balanced.id, gain.id]).toEqual(["safe", "balanced", "gain"]);
    expect(gain.probTarget).toBeGreaterThanOrEqual(balanced.probTarget);
    expect(balanced.probTarget).toBeGreaterThanOrEqual(safe.probTarget);
    expect(safe.var95).toBeLessThanOrEqual(balanced.var95);
    expect(balanced.var95).toBeLessThanOrEqual(gain.var95);
    for (const o of [safe, balanced, gain]) expect(Object.values(o.weights).reduce((a, b) => a + b!, 0)).toBeCloseTo(1, 6);
  }, 60_000);
});

describe("monte carlo", () => {
  it("is reproducible and well-formed", () => {
    const a = project(data, intent, { paths: 2000, seed: 1 });
    const b = project(data, intent, { paths: 2000, seed: 1 });
    expect(a.fan.p50).toEqual(b.fan.p50);
    expect(a.fan.p50).toHaveLength(61);
    expect(a.fan.p50[0]).toBe(10_000);
    expect(a.fan.p5[60]).toBeLessThan(a.fan.p95[60]);
    expect(a.probTarget).toBeGreaterThanOrEqual(0);
    expect(a.probTarget).toBeLessThanOrEqual(1);
  });
  it("a stop-loss caps the worst case and reports stop probability", () => {
    const free = project(data, intent, { paths: 4000, seed: 7 });
    const stopped = project(data, { ...intent, stopLoss: 0.1 }, { paths: 4000, seed: 7 });
    expect(stopped.probStop).toBeGreaterThan(0);
    expect(stopped.cvar95).toBeLessThan(free.cvar95);
    // Daily closes can gap through the level, but never by more than one bad day's move.
    const worst = Math.min(...stopped.fan.p5);
    expect(worst).toBeGreaterThan(10_000 * 0.75);
  });
  it("all-cash allocation never moves", () => {
    const p = project(data, { ...intent, weights: { BTC: 0.0001 } }, { paths: 500, seed: 3 });
    expect(p.fan.p95[60]).toBeLessThan(10_100);
  });
});

describe("agent keys", () => {
  it("base58 matches a known vector and keys sign verifiably", async () => {
    expect(base58(new TextEncoder().encode("Hello World!"))).toBe("2NEpo7TZRRrLZSi2U");
    expect(base58(new Uint8Array([0, 0, 1]))).toBe("112");
    const k = await newAgentKey();
    expect(k.accountId).toMatch(/^[0-9a-f]{64}$/);
    const sig = await signMessage(k, "payload");
    expect(sig.startsWith("ed25519:")).toBe(true);
  });
});

describe("one Helm wallet per NEAR account", () => {
  it("the same account and signature always give the same wallet, on any device", async () => {
    const a = await agentKeyFromSeed(await walletSeed("alice.testnet", "sig-abc"));
    const b = await agentKeyFromSeed(await walletSeed("alice.testnet", "sig-abc"));
    expect(a).toEqual(b);
    expect(a.accountId).toMatch(/^[0-9a-f]{64}$/);
    expect(a.publicKey.startsWith("ed25519:")).toBe(true);
  });
  it("different accounts get different wallets", async () => {
    const a = await agentKeyFromSeed(await walletSeed("alice.testnet", "sig-abc"));
    const c = await agentKeyFromSeed(await walletSeed("bob.testnet", "sig-abc"));
    expect(a.accountId).not.toBe(c.accountId);
  });
  it("the derived key really signs (its public key verifies its signature)", async () => {
    const k = await agentKeyFromSeed(await walletSeed("alice.testnet", "sig-abc"));
    const sigText = await signMessage(k, "payload");
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const unb58 = (s: string) => { let n = 0n; for (const ch of s) n = n * 58n + BigInt(alphabet.indexOf(ch)); const out: number[] = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; } return Uint8Array.from(out); };
    const pub = await crypto.subtle.importKey("raw", unb58(k.publicKey.slice(8)), "Ed25519", false, ["verify"]);
    expect(await crypto.subtle.verify("Ed25519", pub, unb58(sigText.slice(8)), new TextEncoder().encode("payload"))).toBe(true);
  });
});

describe("treasury pays a gain only for a real, matching exit", () => {
  const agent = "a".repeat(64), wallet = "b".repeat(64);
  const args = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");
  const exit = (amount: string, extra: object = {}) => ({
    transaction: { signer_id: agent, receiver_id: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af", actions: [{ FunctionCall: { method_name: "ft_transfer", args: args({ receiver_id: wallet, amount }) } }] },
    status: { SuccessValue: "" }, receipts_outcome: [], ...extra,
  });
  it("accepts a real exit and a gain within the limit", async () => {
    const { checkGainClaim } = await import("./gainClaim");
    expect(checkGainClaim({ exitTx: "x", agent, wallet, paid: "10000000", gain: "240000" }, exit("10000000"))).toBeNull();
  });
  it("refuses forged or oversized claims", async () => {
    const { checkGainClaim } = await import("./gainClaim");
    expect(checkGainClaim({ exitTx: "x", agent, wallet, paid: "10000000", gain: "240000" }, null)).toMatch(/not found/);
    expect(checkGainClaim({ exitTx: "x", agent, wallet, paid: "10000000", gain: "3000000" }, exit("10000000"))).toMatch(/larger/);
    expect(checkGainClaim({ exitTx: "x", agent, wallet, paid: "9000000", gain: "240000" }, exit("10000000"))).toMatch(/stated amount/);
    expect(checkGainClaim({ exitTx: "x", agent: "c".repeat(64), wallet, paid: "10000000", gain: "240000" }, exit("10000000"))).toMatch(/signed by the agent/);
    expect(checkGainClaim({ exitTx: "x", agent, wallet, paid: "10000000", gain: "240000" }, exit("10000000", { status: { Failure: {} } }))).toMatch(/failed/);
  });
});

describe("NEAR transactions signed by browser keys", () => {
  it("signature matches NEAR's own library byte for byte, and verifies", async () => {
    const { KeyPair } = await import("@near-js/crypto");
    const { decodeSignedTransaction, encodeTransaction } = await import("@near-js/transactions");
    const { nearSecretKey } = await import("./agentKey");
    const { signTx, ftTransfer, storageDeposit, USDC_CIRCLE } = await import("./near");
    const key = await agentKeyFromSeed(await walletSeed("alice.testnet", "sig"));
    const signed = await signTx(key, USDC_CIRCLE, [storageDeposit("bob.testnet"), ftTransfer("bob.testnet", 5_000_000n)], 7n, new Uint8Array(32).fill(3));
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encodeTransaction(signed.transaction) as BufferSource));
    const theirs = KeyPair.fromString(nearSecretKey(key) as never);
    expect(theirs.getPublicKey().toString()).toBe(key.publicKey);
    expect(Buffer.from(signed.signature.signature.data).equals(Buffer.from(theirs.sign(hash).signature))).toBe(true);
    expect(theirs.verify(hash, signed.signature.signature.data)).toBe(true);
    const back = decodeSignedTransaction(signed.encode());
    expect(back.transaction.signerId).toBe(key.accountId);
    expect(back.transaction.receiverId).toBe(USDC_CIRCLE);
    expect(back.transaction.actions).toHaveLength(2);
  });
});

describe("multiple strategies", () => {
  it("each agent stops independently and sells only its own holdings", async () => {
    const prices = { BTC: 100, ETH: 10, NEAR: 1 };
    const mk = async (id: string, stopLoss: number, capital: number): Promise<Strategy> => {
      const base: Strategy = {
        id, name: id, intent: { ...intent, capitalUsd: capital, stopLoss }, projection: undefined as never,
        status: "draft", units: {}, cash: 0, entryValue: 0, events: [], createdAt: 0,
      };
      const r = await simulatedExecutor.buy(base, prices, ctx);
      return { ...base, status: "active", units: r.units, cash: r.cash, executedAt: 0 };
    };
    const tight = await mk("tight", 0.05, 10_000);
    const wide = await mk("wide", 0.3, 4_000);
    const crash = { BTC: 90, ETH: 9, NEAR: 0.9 }; // -10% on everything
    expect(decide(tight, crash, 1)).toBe("stop-loss");
    expect(decide(wide, crash, 1)).toBe("hold");
    const sold = await simulatedExecutor.sell(tight, crash, ctx);
    expect(sold.proceeds).toBeGreaterThan(8_900);
    expect(sold.proceeds).toBeLessThan(9_000);
    expect(Object.keys(sold.remaining)).toHaveLength(0);
    // the wide strategy is untouched by the other's exit
    expect(portfolioValue(wide, prices)).toBeCloseTo(4_000 * 0.9994 + 0.0, -1);
  });
});

describe("stop-loss agent", () => {
  const prices = { BTC: 100, ETH: 10, NEAR: 1 };
  const legs = allocation(intent, 10_000);
  const s: Strategy = {
    id: "x", name: "x", intent: { ...intent, stopLoss: 0.1 }, projection: undefined as never, status: "active",
    units: Object.fromEntries(legs.map((l) => [l.symbol, l.usd / (prices as Record<string, number>)[l.symbol]])), cash: 0,
    executedAt: 0, entryValue: 10_000, events: [], createdAt: 0,
  };
  it("holds above the line, fires at -10%", () => {
    expect(portfolioValue(s, prices)).toBeCloseTo(10_000);
    expect(decide(s, prices, 1)).toBe("hold");
    expect(decide(s, { BTC: 91, ETH: 9.1, NEAR: 0.91 }, 1)).toBe("hold"); // -9%
    expect(decide(s, { BTC: 90, ETH: 9, NEAR: 0.9 }, 1)).toBe("stop-loss"); // -10%
  });
  it("never fires a stop-loss on a missing or broken price", () => {
    expect(decide(s, { BTC: 100, ETH: 10 } as never, 1)).toBe("hold"); // NEAR price missing
    expect(decide(s, { BTC: 100, ETH: 10, NEAR: NaN }, 1)).toBe("hold");
    expect(decide(s, { BTC: 100, ETH: 10, NEAR: 0 }, 1)).toBe("hold");
    expect(decide(s, { BTC: 100, ETH: 10 } as never, 61 * 86_400_000)).toBe("expired"); // the horizon still closes it
  });
  it("closes at the goal (take-profit)", () => {
    const withGoal = { ...s, intent: { ...s.intent, targetRoi: 0.05 } };
    expect(decide(withGoal, { BTC: 104, ETH: 10.4, NEAR: 1.04 }, 1)).toBe("hold"); // +4%
    expect(decide(withGoal, { BTC: 105, ETH: 10.5, NEAR: 1.05 }, 1)).toBe("take-profit"); // +5%
    expect(decide({ ...withGoal, intent: { ...withGoal.intent, targetRoi: 0 } }, { BTC: 200, ETH: 20, NEAR: 2 }, 1)).toBe("hold"); // no goal set
  });
  it("ignores inactive agents and expires at the horizon", () => {
    expect(decide({ ...s, status: "stopped" }, { BTC: 1, ETH: 1, NEAR: 1 }, 1)).toBe("hold");
    expect(decide(s, prices, 61 * 86_400_000)).toBe("expired");
  });
});
