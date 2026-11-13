"use client";
import { useEffect, useState } from "react";

/** Small app-wide toasts: the confirmed "after" state of an action, optionally with one action such as Undo. */
export interface Toast { id: number; text: string; tone?: "good" | "bad"; action?: { label: string; run: () => void } }

let next = 1;
let items: Toast[] = [];
const subs = new Set<(t: Toast[]) => void>();
const emit = () => subs.forEach((f) => f(items));

export function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(text: string, opts: Omit<Toast, "id" | "text"> = {}) {
  const t = { id: next++, text, ...opts };
  items = [...items.slice(-2), t];
  emit();
  setTimeout(() => dismiss(t.id), t.action ? 7000 : 4500);
}

export function Toaster() {
  const [list, setList] = useState<Toast[]>(items);
  useEffect(() => {
    subs.add(setList);
    return () => { subs.delete(setList); };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? ""}`}>
          <span className="toast-dot" aria-hidden />
          <span className="grow">{t.text}</span>
          {t.action && <button className="btn sm ghost" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button className="x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
