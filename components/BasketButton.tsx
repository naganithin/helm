"use client";
import { useState } from "react";
import { assetInfo, KIND_LABEL, type AssetKind } from "@/lib/types";
import { NetTag } from "./Analysis";
import { useBasket } from "./basket";

const KIND_ORDER: AssetKind[] = ["stock", "etf", "bond", "commodity", "crypto"];

/** Header cart: shows what is in the basket grouped by type, on hover or focus, with a way into the strategy builder. */
export function BasketButton({ onBuild }: { onBuild: () => void }) {
  const b = useBasket();
  const [pinned, setPinned] = useState(false); // tap to keep it open on touch screens
  const groups = KIND_ORDER.map((k) => ({ k, list: b.items.filter((s) => assetInfo(s).kind === k) })).filter((g) => g.list.length);
  return (
    <div className={`cart float ${pinned ? "pinned" : ""}`} onMouseLeave={() => setPinned(false)}>
      <button className="cart-btn" aria-haspopup="true" aria-expanded={pinned} onClick={() => setPinned((v) => !v)} aria-label={`Basket, ${b.items.length} assets`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 6h15l-1.6 8.5a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.6L5 3H2" /><circle cx="9.5" cy="20" r="1.4" /><circle cx="17.5" cy="20" r="1.4" /></svg>
        <span>Basket</span>
        {b.items.length > 0 && <span key={b.items.length} className="cart-n bump">{b.items.length}</span>}
      </button>
      <div className="cart-pop" role="region" aria-label="Your basket">
        <div className="row between"><b>Your basket</b>{b.items.length > 0 && <button className="btn ghost sm" onClick={b.clear}>Clear</button>}</div>
        {b.items.length === 0 ? (
          <p className="small muted" style={{ margin: "8px 0 0" }}>Empty. Add stocks, crypto, funds, bonds or gold from the Assets and Market sections, then build one strategy from them.</p>
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.k} className="cart-group">
                <div className="cart-gh"><span>{KIND_LABEL[g.k]}</span><span>{g.list.length}</span></div>
                {g.list.map((s) => (
                  <div key={s} className="cart-item">
                    <div><b>{s}</b> <span className="muted small">{assetInfo(s).name}</span> <NetTag net={assetInfo(s).network} /></div>
                    <button className="x" onClick={() => b.remove(s)} aria-label={`Remove ${s}`}>×</button>
                  </div>
                ))}
              </div>
            ))}
            <button className="btn primary cart-build" onClick={() => { setPinned(false); onBuild(); }}>Build a strategy from {b.items.length} asset{b.items.length === 1 ? "" : "s"}</button>
          </>
        )}
      </div>
    </div>
  );
}
