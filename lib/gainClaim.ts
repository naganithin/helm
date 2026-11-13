import { USDC_CIRCLE } from "./near.ts";

// The treasury pays a strategy's gain only for a real exit: the agent's own transaction on NEAR that returned its
// USDC to the Helm wallet. This checks that transaction and the size of the claim. Pure, so it is unit-tested.

export interface GainClaim { exitTx: string; agent: string; wallet: string; paid: string; gain: string }
export interface TxView {
  transaction: { signer_id: string; receiver_id: string; actions: ({ FunctionCall?: { method_name: string; args: string } } | string)[] };
  status: Record<string, unknown>;
  receipts_outcome?: { outcome: { status: Record<string, unknown> } }[];
}
export const MAX_GAIN_RATIO = 0.25; // at most +25% of what the agent returned

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const decode = (b64: string) => { try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")); } catch { return {}; } };

/** Returns why the claim is refused, or null when it may be paid. */
export function checkGainClaim(c: GainClaim, tx: TxView | null): string | null {
  if (!/^[0-9a-f]{64}$/.test(c.agent)) return "bad agent account";
  if (!ACCOUNT.test(c.wallet) || c.wallet.length > 64) return "bad wallet account";
  if (!/^\d{1,18}$/.test(c.paid) || !/^\d{1,18}$/.test(c.gain)) return "bad amounts";
  const paid = BigInt(c.paid), gain = BigInt(c.gain);
  if (gain <= 0n) return "no gain to pay";
  if (Number(gain) > Number(paid) * MAX_GAIN_RATIO) return "gain larger than the treasury pays for one exit";
  if (!tx) return "exit transaction not found";
  if (tx.transaction.signer_id !== c.agent) return "exit was not signed by the agent";
  if (tx.transaction.receiver_id !== USDC_CIRCLE) return "exit did not move USDC";
  const statuses = [tx.status, ...(tx.receipts_outcome ?? []).map((r) => r.outcome.status)];
  if (statuses.some((s) => s && "Failure" in s)) return "exit transaction failed";
  const returned = tx.transaction.actions.some((a) => typeof a === "object" && a.FunctionCall?.method_name === "ft_transfer"
    && decode(a.FunctionCall.args).receiver_id === c.wallet && decode(a.FunctionCall.args).amount === c.paid);
  return returned ? null : "exit did not return the stated amount to the wallet";
}