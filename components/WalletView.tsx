"use client";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { accountUrl, txUrl } from "@/lib/near";
import { DEPOSIT_NETWORKS } from "@/lib/tidepool";
import { otherTokensNamed, readBalance, SENDABLE, sendToHelmWallet, type Sendable, type useNearWallet } from "./nearWallet";
import { usd } from "@/lib/format";
import { toast } from "./toast";
import { Skel } from "./ui";
import type { Helm } from "./useHelm";

/** Middle-ellipsis for long account ids so both ends stay recognisable. */
const short = (id?: string | null) => (!id ? "–" : id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id);

/** Who pays and who receives, before the user confirms. */
function Transfer({ from, fromId, to, toId }: { from: string; fromId?: string | null; to: string; toId?: string | null }) {
  return (
    <div className="transfer" aria-label={`From ${from} to ${to}`}>
      <div><span>From · {from}</span><b className="hash" title={fromId ?? undefined}>{short(fromId)}</b></div>
      <div className="arrow" aria-hidden>→</div>
      <div><span>To · {to}</span><b className="hash" title={toId ?? undefined}>{short(toId)}</b></div>
    </div>
  );
}

/** 25% / 50% / Max of a balance, rounded down so the amount never exceeds it. */
function Presets({ max, dp, onPick }: { max: number | null; dp: number; onPick: (v: string) => void }) {
  const ok = max != null && max > 0;
  const f = 10 ** dp;
  return (
    <div className="chips">
      {([["25%", 0.25], ["50%", 0.5], ["Max", 1]] as const).map(([l, k]) => (
        <button key={l} type="button" className="chip" disabled={!ok} onClick={() => ok && onPick(String(Math.floor(max * k * f) / f))}>{l}</button>
      ))}
    </div>
  );
}

type W = ReturnType<typeof useNearWallet>;
const CHAINS: Record<string, string[]> = {
  Ethereum: ["USDC", "USDT", "ETH"], Base: ["USDC", "ETH"], Arbitrum: ["USDC", "ARB"],
  Solana: ["USDC", "SOL"], Bitcoin: ["BTC"], NEAR: ["USDC", "NEAR"],
};
const STABLE = new Set(["USDC", "USDT"]);

function DemoDeposit({ h }: { h: Helm }) {
  const [chain, setChain] = useState("Ethereum");
  const [token, setToken] = useState("USDC");
  const [amount, setAmount] = useState("1000");
  const price = STABLE.has(token) ? 1 : (h.prices as Record<string, number>)[token] ?? (token === "ETH" ? 2000 : undefined);
  const amt = Number(amount);
  const credit = price && amt > 0 ? amt * price * 0.998 : 0;
  return (
    <div className="card">
      <div className="eyebrow">Add funds</div>
      <p className="muted small" style={{ margin: 0 }}>Any network, any token, converted to USDC. Simulated in the demo.</p>
      <div className="row wrapr">
        <select value={chain} onChange={(e) => { setChain(e.target.value); setToken(CHAINS[e.target.value][0]); }} style={{ flex: 1 }}>
          {Object.keys(CHAINS).map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1 }}>
          {CHAINS[chain].map((t) => <option key={t}>{t}</option>)}
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount" style={{ flex: 1 }} />
      </div>
      <div className="row between">
        <span className="muted small">≈ {usd(credit)} USDC after a 0.2% conversion fee</span>
        <button className="btn primary" disabled={credit <= 0} onClick={() => h.deposit(credit)}>Deposit</button>
      </div>
    </div>
  );
}

function Qr({ value, size = 168 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, color: { dark: "#111111", light: "#ffffff" } }).then((u) => live && setSrc(u)).catch(() => {});
    return () => { live = false; };
  }, [value, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={`QR code for ${value}`} /> : <div className="qr" style={{ width: size, height: size }} />;
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row">
      <code className="addr">{value}</code>
      <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

/** Send USDC or NEAR from the connected NEAR wallet straight into the Helm wallet: one signed transaction. */
function FromWallet({ h, w }: { h: Helm; w: W }) {
  const [token, setToken] = useState<Sendable>("USDC");
  const [bal, setBal] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [others, setOthers] = useState<{ contract: string; amount: number }[]>([]);
  const acct = w.accountId;
  const load = useCallback(() => {
    if (!acct) return;
    setBal(null); setOthers([]);
    readBalance(token, acct).then((b) => {
      setBal(b);
      if (b === 0) otherTokensNamed(token, acct).then(setOthers).catch(() => {}); // explain a zero: same name, different token?
    }).catch(() => setBal(null));
  }, [acct, token]);
  useEffect(() => { load(); }, [load]);
  const vault = h.vault?.accountId;
  const dp = token === "NEAR" ? 4 : 2;
  const amt = Number(amount);

  async function send() {
    setErr(undefined); setMsg(undefined);
    const amt = Number(amount);
    if (!(amt > 0)) return setErr("Enter an amount");
    if (bal != null && amt > bal) return setErr(others.length ? `None of your ${token} can be used here (see below).` : `Your wallet has ${bal.toFixed(token === "NEAR" ? 4 : 2)} ${token} that Helm can accept.`);
    if (!vault) return setErr("Unlock your Helm wallet first");
    setBusy(true);
    try {
      await sendToHelmWallet(token, amount.trim(), vault);
      setMsg(`Sent ${amount} ${token}. Updating your balance…`);
      setAmount("");
      for (const wait of [4000, 6000, 10000, 15000]) { await new Promise((r) => setTimeout(r, wait)); await h.refreshVault(); load(); }
      setMsg(`Done. ${token} is in your Helm wallet.`);
      toast(`${token} arrived in your Helm wallet.`, { tone: "good" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="seg" role="tablist" aria-label="Token">
        {(Object.keys(SENDABLE) as Sendable[]).map((t) => <button key={t} role="tab" aria-selected={token === t} className={token === t ? "on" : ""} onClick={() => setToken(t)}>{t}</button>)}
      </div>
      <Transfer from="Your NEAR wallet" fromId={acct} to="Your Helm wallet" toId={vault} />
      <div className="row between wrapr small">
        <span className="muted">Available in your NEAR wallet</span>
        <b className="mono">{bal == null ? <Skel w={70} h={14} /> : `${bal.toFixed(dp)} ${token}`}</b>
      </div>
      <input className="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label={`Amount of ${token} to send`} placeholder={`0 ${token}`} />
      <Presets max={bal} dp={dp} onPick={setAmount} />
      {token === "USDC" && h.vaultUsdc != null && (
        <div className="after"><span>Helm wallet after</span><b>{usd(h.vaultUsdc + (amt > 0 ? amt : 0))}</b></div>
      )}
      <button className="btn primary big" disabled={busy || !amount || !vault} onClick={send}>
        {busy ? "Confirm in wallet…" : amt > 0 ? `Send ${amount.trim()} ${token}` : "Send to Helm"}
      </button>
      {others.length > 0 && (
        <div className="verdict bad" role="note">
          <b>Why it shows 0:</b> your wallet holds {others.map((o) => `${o.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${token}`).join(" and ")} from a different {token} token ({others.map((o) => `${o.contract.length > 24 ? `${o.contract.slice(0, 8)}…${o.contract.slice(-6)}` : o.contract}`).join(", ")}). Tokens can share a name but be separate contracts, and Helm only accepts {token} issued by <span className="mono">{SENDABLE[token]?.contract}</span>. Your other {token} is safe in your wallet; it just can&apos;t be used here.
        </div>
      )}
      {h.settlement === "helm" && <p className="fine">The first deposit also sends 0.3 NEAR from your wallet to cover network fees for your Helm wallet and its agents.</p>}
      {token === "NEAR" && <p className="fine">NEAR in your Helm wallet counts as buying power: when a strategy runs, Helm converts just enough of it to USDC.</p>}
      {err && <p className="bad small" role="alert" style={{ margin: 0 }}>{err}</p>}
      {msg && <p className="good small" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}

/** Your Helm wallet's address on each network: created once, reused until it expires, renewed automatically. */
function FromNetwork({ h }: { h: Helm }) {
  const chains = Object.keys(DEPOSIT_NETWORKS);
  const [chain, setChain] = useState(chains[0]);
  const a = h.addrs[chain];
  const left = a ? Math.max(0, new Date(a.deadline).getTime() - Date.now()) : 0;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="seg wrap" role="tablist" aria-label="Network">
        {chains.map((c) => <button key={c} role="tab" aria-selected={chain === c} className={chain === c ? "on" : ""} onClick={() => setChain(c)}>{DEPOSIT_NETWORKS[c]}</button>)}
      </div>
      {a ? (
        <div className="row wrapr" style={{ alignItems: "flex-start", gap: 20 }}>
          <Qr value={a.address} />
          <div className="col" style={{ flex: 1, minWidth: 240, gap: 10 }}>
            <div className="small">Send <b>USDC on {DEPOSIT_NETWORKS[chain]}</b>, any amount, to:</div>
            <CopyRow value={a.address} />
            <div className="small muted">It arrives in your Helm wallet as USDC. This address stays the same for {Math.max(1, Math.floor(left / 3_600_000))} more hours, then Helm renews it automatically. Send only USDC on {DEPOSIT_NETWORKS[chain]}.</div>
          </div>
        </div>
      ) : (
        <div className="row small muted" style={{ gap: 10 }}><span className="spinner" aria-hidden /> Preparing your {DEPOSIT_NETWORKS[chain]} address… <button className="btn ghost sm" onClick={() => void h.refreshAddrs()}>Retry</button></div>
      )}
    </div>
  );
}

/** Helm settlement: move USDC from the Helm wallet back to the connected NEAR wallet (a real NEAR transaction). */
function Withdraw({ h, w }: { h: Helm; w: W }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [hash, setHash] = useState<string>();
  const free = h.free;
  async function go() {
    setErr(undefined); setHash(undefined); setBusy(true);
    try {
      setHash(await h.withdraw(amt));
      toast(`Withdrew ${usd(amt)} to your NEAR wallet.`, { tone: "good" });
      setAmount("");
    }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const amt = Number(amount);
  return (
    <div className="col" style={{ gap: 12 }}>
      <Transfer from="Your Helm wallet" fromId={h.vault?.accountId} to="Your NEAR wallet" toId={w.accountId} />
      <div className="row between wrapr small"><span className="muted">Free to withdraw</span><b className="mono">{usd(free)}</b></div>
      <input className="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount of USDC to withdraw" placeholder="0 USDC" />
      <Presets max={free} dp={2} onPick={setAmount} />
      <div className="after"><span>Helm wallet after</span><b>{usd(Math.max(0, free - (amt > 0 ? amt : 0)))}</b></div>
      <button className="btn primary big" disabled={busy || !amount} onClick={go}>{busy ? "Sending…" : amt > 0 ? `Withdraw ${usd(amt)}` : "Withdraw"}</button>
      {err && <p className="bad small" role="alert" style={{ margin: 0 }}>{err}</p>}
      {hash && <p className="good small" style={{ margin: 0 }}>Sent. <a href={txUrl(hash)} target="_blank" rel="noreferrer">View the transaction ↗</a></p>}
    </div>
  );
}

function LiveFunding({ h, w }: { h: Helm; w: W }) {
  const [tab, setTab] = useState<"wallet" | "network" | "withdraw" | "id">("wallet");
  const helmSettle = h.settlement === "helm";
  if (!h.vault) {
    return (
      <div className="card">
        <div className="eyebrow">Unlock your Helm wallet</div>
        <p className="small" style={{ margin: 0 }}>Your Helm wallet is tied to <b>{w.accountId}</b>. Sign one message in your NEAR wallet to open it. The same account always opens the same Helm wallet, on any device. Signing does not move funds.</p>
        {h.unlockError && <p className="bad small" role="alert" style={{ margin: 0 }}>{h.unlockError}</p>}
        <div><button className="btn primary" onClick={() => void h.unlockVault()}>Sign to unlock</button></div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="eyebrow">Add funds</div>
      <div className="seg" role="tablist" aria-label="How to add funds">
        <button role="tab" aria-selected={tab === "wallet"} className={tab === "wallet" ? "on" : ""} onClick={() => setTab("wallet")}>From NEAR wallet</button>
        {helmSettle
          ? <button role="tab" aria-selected={tab === "withdraw"} className={tab === "withdraw" ? "on" : ""} onClick={() => setTab("withdraw")}>Withdraw</button>
          : <button role="tab" aria-selected={tab === "network"} className={tab === "network" ? "on" : ""} onClick={() => setTab("network")}>From another network</button>}
        <button role="tab" aria-selected={tab === "id"} className={tab === "id" ? "on" : ""} onClick={() => setTab("id")}>Helm wallet ID</button>
      </div>
      {tab === "wallet" && <FromWallet h={h} w={w} />}
      {tab === "network" && <FromNetwork h={h} />}
      {tab === "withdraw" && <Withdraw h={h} w={w} />}
      {tab === "id" && (
        <div className="row wrapr" style={{ alignItems: "flex-start", gap: 20 }}>
          <Qr value={h.vault.accountId} />
          <div className="col" style={{ flex: 1, minWidth: 240, gap: 10 }}>
            <div className="small muted">Your Helm wallet on NEAR. It is derived from {w.accountId}, so it never changes.</div>
            <CopyRow value={h.vault.accountId} />
            {helmSettle && <a className="small good" href={accountUrl(h.vault.accountId)} target="_blank" rel="noreferrer">See it on NearBlocks ↗</a>}
          </div>
        </div>
      )}
      <div className="row between wrapr">
        <span className="small">{h.vaultError ? <span className="bad">Balance check failed: {h.vaultError}</span> : <>Holds <b className="mono">{h.vaultUsdc == null ? <Skel w={70} h={14} /> : usd(h.vaultUsdc)}</b> USDC{h.vaultNear > 0 && <> and <b className="mono">{h.vaultNear.toFixed(4)}</b> NEAR</>}{helmSettle && h.vaultGas != null && <span className="muted"> · {h.vaultGas.toFixed(3)} NEAR for fees</span>}</>}</span>
        <button className="btn" onClick={h.refreshVault}>Refresh</button>
      </div>
    </div>
  );
}

export function WalletView({ h, w }: { h: Helm; w: W }) {
  const total = h.free + h.deployed;
  const running = h.strategies.filter((s) => s.status === "active");
  const ledger = useMemo(
    () => h.strategies
      .flatMap((s) => s.events.filter((e) => e.kind === "executed" || e.kind === "stop-loss" || e.kind === "closed").map((e) => ({ ...e, id: s.id, name: s.name })))
      .sort((a, b) => b.t - a.t)
      .slice(0, 12),
    [h.strategies],
  );
  return (
    <section className="view">
      <div className="view-head">
        <h1 className="display">One wallet. <em>Many agents.</em></h1>
        <p>You fund a single Helm wallet. When a strategy runs, its agent draws what it needs into its own account, and returns it when it exits.</p>
      </div>
      <div className="grid2">
        <div className="col">
          <div className="card">
            <div className="eyebrow">Wallet balance · total</div>
            <div className="bignum">{usd(total)}</div>
            <div className="split" aria-hidden>
              <div className="free" style={{ width: `${total ? (h.free / total) * 100 : 100}%` }} />
              <div className="dep" style={{ width: `${total ? (h.deployed / total) * 100 : 0}%` }} />
            </div>
            <div className="row between small wrapr">
              <span><i className="sw" style={{ background: "var(--c1)" }} />Available <b className="mono">{usd(h.free)}</b></span>
              <span><i className="sw" style={{ background: "var(--good)" }} />In {running.length} agent{running.length === 1 ? "" : "s"} <b className="mono">{usd(h.deployed)}</b></span>
            </div>
          </div>
          <div className="card">
            <div className="eyebrow">How money moves</div>
            <div className="flow">
              <div><b>Helm wallet</b>your balance</div>
              <div className="arrow">run<br />→</div>
              <div><b>Agent</b>one per strategy</div>
              <div className="arrow">exit<br />→</div>
              <div><b>Helm wallet</b>proceeds return</div>
            </div>
            <p className="fine">{h.demo ? "Simulated in the demo." : "Each strategy's assets are delivered straight into its agent's own account on NEAR. On exit the agent sells back to USDC and returns it to your Helm wallet."}</p>
          </div>
        </div>
        <div className="col">
          {h.demo ? <DemoDeposit h={h} /> : <LiveFunding h={h} w={w} />}
          <div className="card">
            <div className="eyebrow">Activity</div>
            {ledger.length ? (
              <div className="ledger">
                {ledger.map((e, i) => <div key={i}><span><b>{e.name}</b> <span className="muted">{e.message}</span></span><time>{new Date(e.t).toLocaleDateString()}</time></div>)}
              </div>
            ) : <p className="muted small" style={{ margin: 0 }}>No movements yet.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}