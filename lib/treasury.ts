import { agentKeyFromSeed, type AgentKey } from "./agentKey.ts";

/** Server only: the treasury's key from HELM_TREASURY_SEED (64 hex chars), or null if not configured. */
export async function treasuryKey(): Promise<AgentKey | null> {
  const hex = process.env.HELM_TREASURY_SEED?.trim();
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return agentKeyFromSeed(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))));
}