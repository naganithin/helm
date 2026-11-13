"use client";
import { useEffect, useState } from "react";

// Each palette is one complete look: two colours that sit together (background and text) and one
// contrasting accent. Whether it reads light or dark comes from the palette itself.
export const PALETTES = [
  { id: "harbor", name: "Harbor", hint: "Midnight navy · dark blue · sunset orange", tone: "dark", a: "#0b1630", b: "#ff7a2f" },
  { id: "chalk", name: "Chalk", hint: "Chalk white · ink black · acid green", tone: "light", a: "#f7f7f2", b: "#c6f432" },
  { id: "cream", name: "Cream", hint: "Cream · ink black · burnt orange", tone: "light", a: "#f6efe2", b: "#b5521b" },
  { id: "sand", name: "Sand", hint: "Charcoal · sand · electric blue", tone: "dark", a: "#24262a", b: "#4d7cff" },
] as const;

export function applyPalette(id: string) {
  const p = PALETTES.find((x) => x.id === id) ?? PALETTES[0];
  document.documentElement.dataset.palette = p.id;
  document.documentElement.dataset.theme = p.tone;
}

/** Palette picker. The first paint is handled by the script in layout.tsx. */
export function ThemeControls({ compact = false }: { compact?: boolean }) {
  const [palette, setPalette] = useState("harbor");
  const [open, setOpen] = useState(false);
  useEffect(() => { try { setPalette(localStorage.getItem("helm:palette") ?? "harbor"); } catch {} }, []);
  const choose = (id: string) => {
    setPalette(id); applyPalette(id);
    try { localStorage.setItem("helm:palette", id); } catch {}
  };
  const body = (
    <div className="swatches" role="radiogroup" aria-label="Colour palette">
      {PALETTES.map((p) => (
        <button key={p.id} role="radio" aria-checked={palette === p.id} title={`${p.name}: ${p.hint}`} className={`swatch ${palette === p.id ? "on" : ""}`} onClick={() => choose(p.id)}>
          <i style={{ background: `linear-gradient(135deg, ${p.a} 55%, ${p.b} 55%)` }} />
          <span>{p.name}</span>
        </button>
      ))}
    </div>
  );
  if (!compact) return body;
  return (
    <div className="themepop">
      <button className="iconbtn" aria-label="Colour palette" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" /></svg>
      </button>
      {open && <div className="themepop-panel" onMouseLeave={() => setOpen(false)}>{body}</div>}
    </div>
  );
}