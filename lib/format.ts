// One place for how money and change are written, so every screen agrees.

/** "$10.50" under $100 (cents always shown), "$1,234" above. */
export function usd(v: number): string {
  const a = Math.abs(v);
  const s = a < 100
    ? a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : a.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${v < 0 && s !== "0.00" ? "-" : ""}$${s}`;
}

/** "+$1.20" / "-$0.40". */
export const signedUsd = (v: number) => `${v >= 0 ? "+" : "-"}${usd(Math.abs(v))}`;

/** A ratio as a percentage: pct(0.123) = "12.3%". */
export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

/** A signed ratio as a percentage: signedPct(0.0123) = "+1.23%". */
export const signedPct = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
