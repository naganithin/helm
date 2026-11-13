// Probes the real Tidepool API with a fresh unfunded agent key. Expected outcome:
// auth OK, zero balances, quote + signed intent accepted by the API but rejected by the verifier
// for insufficient balance (proves the raw_ed25519 signing scheme without needing funds).
import { newAgentKey, signMessage } from "../lib/agentKey.ts";
import { BASE, USDC, TRADABLE, balances, tokens } from "../lib/tidepool.ts";

const key = await newAgentKey();
console.log("agent account:", key.accountId);
const t = await tokens();
console.log("tokens listed:", t.size, "| wbtc/eth/wnear present:", Object.values(TRADABLE).map((a) => t.has(a)));
console.log("balances:", await balances(key, [USDC, ...Object.values(TRADABLE)]));

const j = async (p, body) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const q = await j("/v0/quote", {
  dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC, depositType: "INTENTS",
  destinationAsset: TRADABLE.BTC, amount: "1000000", refundTo: key.accountId, refundType: "INTENTS",
  recipient: key.accountId, recipientType: "INTENTS", deadline: new Date(Date.now() + 3600e3).toISOString(),
});
console.log("quote:", q.status, q.body.quote?.amountOutFormatted, "wBTC for 1 USDC");
const g = await j("/v0/generate-intent", { type: "swap_transfer", standard: "raw_ed25519", signerId: key.accountId, depositAddress: q.body.quote.depositAddress });
const payload = g.body.intent.payload;
const s = await j("/v0/submit-intent", {
  type: "swap_transfer",
  signedData: { standard: "raw_ed25519", payload, public_key: key.publicKey, signature: await signMessage(key, payload) },
});
console.log("submit:", s.status, JSON.stringify(s.body));
