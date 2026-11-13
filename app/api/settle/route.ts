import { NextResponse } from "next/server";
import { checkGainClaim, type GainClaim, type TxView } from "@/lib/gainClaim";
import { ftTransfer, nearRpc, sendTx, USDC_CIRCLE } from "@/lib/near";
import { treasuryKey } from "@/lib/treasury";

export const dynamic = "force-dynamic";
const paidExits = new Set<string>(); // one payout per exit transaction

/** The treasury pays a strategy's gain after verifying the agent's exit transaction on NEAR. */
export async function POST(req: Request) {
  const key = await treasuryKey();
  if (!key) return NextResponse.json({ error: "Treasury is not configured" }, { status: 503 });
  let c: GainClaim;
  try { c = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }
  if (typeof c?.exitTx !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(c.exitTx)) return NextResponse.json({ error: "bad exit transaction" }, { status: 400 });
  if (paidExits.has(c.exitTx)) return NextResponse.json({ error: "This exit was already settled" }, { status: 409 });
  const tx = await nearRpc<TxView>("tx", { tx_hash: c.exitTx, sender_account_id: c.agent, wait_until: "EXECUTED_OPTIMISTIC" }).catch(() => null);
  const why = checkGainClaim(c, tx);
  if (why) return NextResponse.json({ error: `Gain refused: ${why}` }, { status: 400 });
  paidExits.add(c.exitTx);
  try {
    const hash = await sendTx(key, USDC_CIRCLE, [ftTransfer(c.wallet, BigInt(c.gain), `Helm gain for exit ${c.exitTx.slice(0, 10)}`)]);
    return NextResponse.json({ tx: hash });
  } catch (e) {
    paidExits.delete(c.exitTx);
    return NextResponse.json({ error: `Treasury could not pay: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}