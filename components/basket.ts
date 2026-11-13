"use client";
import { useSyncExternalStore } from "react";
import { SYMBOLS, type Symbol } from "@/lib/types";

// The basket is a small cart of assets the user is collecting before building a strategy.
// A module-level store keeps the header popover, the Assets/Market pages and the builder in sync.
const KEY = "helm:basket:v1";
const EMPTY: Symbol[] = [];
let items: Symbol[] = EMPTY;
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(raw)) items = raw.filter((s): s is Symbol => SYMBOLS.includes(s));
  } catch {}
}
function commit(next: Symbol[]) {
  items = next.length ? next : EMPTY;
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => { load(); subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => { load(); return items; };

export function useBasket() {
  const list = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  return {
    items: list,
    has: (s: Symbol) => list.includes(s),
    add: (s: Symbol) => { if (!list.includes(s)) commit([...list, s]); },
    remove: (s: Symbol) => commit(list.filter((x) => x !== s)),
    toggle: (s: Symbol) => commit(list.includes(s) ? list.filter((x) => x !== s) : [...list, s]),
    clear: () => commit([]),
  };
}
