import { NextResponse } from "next/server";
import { ftBalance, nearBalance, nearRpc, USDC_CIRCLE } from "@/lib/near";
import { treasuryKey } from "@/lib/treasury";

export const dynamic = "force-dynamic";

/** Public status of the treasury: its account and what it holds (no secrets). */
export async function GET() {
  const key = await treasuryKey();
  if (!key) return NextResponse.json({ configured: false });
  const [usdc, near, reg] = await Promise.all([
    ftBalance(USDC_CIRCLE, key.accountId).catch(() => 0n),
    nearBalance(key.accountId).catch(() => null),
    nearRpc<{ result: number[] }>("query", { request_type: "call_function", finality: "final", account_id: USDC_CIRCLE, method_name: "storage_balance_of", args_base64: Buffer.from(JSON.stringify({ account_id: key.accountId })).toString("base64") })
      .then((r) => JSON.parse(Buffer.from(r.result).toString("utf8")) !== null).catch(() => false),
  ]);
  return NextResponse.json({ configured: true, account: key.accountId, usdc: Number(usdc) / 1e6, near: near == null ? 0 : Number(near) / 1e24, registered: reg });
}