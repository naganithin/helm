"use client";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { sendToHelmWallet, useNearWallet } from "@/components/nearWallet";
import { Wallet } from "@/components/Wallet";
import { accountUrl } from "@/lib/near";

interface Status { configured: boolean; account?: string; usdc?: number; near?: number; registered?: boolean }

/** Not linked from the menu: the operator funds the treasury (market maker) that pays gains and receives losses. */
export default function TreasuryPage() {
  const w = useNearWallet();
  const [s, setS] = useState<Status>();
  const [amount, setAmount] = useState("5");
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { fetch("/api/treasury").then((r) => r.json()).then(setS).catch(() => setS({ configured: false })); }, []);
  useEffect(() => { load(); }, [load]);
  async function fund() {
    if (!s?.account) return;
    setErr(undefined); setMsg(undefined); setBusy(true);
    try {
      await sendToHelmWallet("USDC", amount, s.account);
      setMsg("Sent. Updating…");
      for (const wait of [4000, 6000, 10000]) { await new Promise((r) => setTimeout(r, wait)); load(); }
      setMsg("Done.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <main className="wrap" style={{ maxWidth: 720, paddingTop: 40, paddingBottom: 60 }}>
      <div className="row between" style={{ marginBottom: 28 }}><Logo /><Wallet w={w} /></div>
      <div className="card">
        <div className="eyebrow">Helm treasury</div>
        <h2 className="display" style={{ fontSize: 34 }}>The other side of every trade.</h2>
        <p className="muted small" style={{ margin: 0 }}>When a strategy closes in profit, the treasury pays the gain to the user&apos;s Helm wallet (after checking the agent&apos;s exit transaction on NEAR, at most 25% per exit). When it closes at a loss, the difference comes here. Fund it with a few USDC before a demo.</p>
        {!s ? <p className="muted small">Loading…</p> : !s.configured ? <p className="bad small">Not configured: set HELM_TREASURY_SEED in .env.local and restart.</p> : (
          <>
            <div className="row between wrapr small"><span>Account <a className="hash" href={accountUrl(s.account!)} target="_blank" rel="noreferrer">{s.account!.slice(0, 12)}…{s.account!.slice(-6)} ↗</a></span><span>Holds <b className="mono">{s.usdc!.toFixed(2)} USDC</b> · {s.near!.toFixed(3)} NEAR{!s.registered && " · not registered yet"}</span></div>
            {w.accountId ? (
              <div className="row">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="USDC to add to the treasury" />
                <button className="btn primary" disabled={busy} onClick={fund}>{busy ? "Confirm in wallet…" : "Fund treasury"}</button>
              </div>
            ) : <div><button className="btn primary" disabled={!w.ready} onClick={w.connect}>Connect wallet</button></div>}
            <p className="fine">The first funding also sends 0.3 NEAR so the treasury can pay network fees.</p>
            {err && <p className="bad small" role="alert" style={{ margin: 0 }}>{err}</p>}
            {msg && <p className="good small" style={{ margin: 0 }}>{msg}</p>}
          </>
        )}
      </div>
    </main>
  );
}