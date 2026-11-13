"use client";
import type { useNearWallet } from "./nearWallet";

type W = ReturnType<typeof useNearWallet>;

/** Header button: connect (opens the wallet list, Meteor first) or show the account with a disconnect. */
export function Wallet({ w }: { w: W }) {
  if (w.error) return <span className="pill bad" title={w.error}>Wallet unavailable</span>;
  return w.accountId ? (
    <div className="acct">
      <span className="dot" aria-hidden />
      <span className="hash" title={w.accountId}>{w.accountId.length > 22 ? `${w.accountId.slice(0, 10)}…${w.accountId.slice(-8)}` : w.accountId}</span>
      <button className="btn ghost sm" onClick={() => void w.disconnect()}>Disconnect</button>
    </div>
  ) : (
    <button className="btn primary sm" disabled={!w.ready} onClick={w.connect}>{w.ready ? "Connect wallet" : "Loading…"}</button>
  );
}
