'use client';

import { useSyncExternalStore } from 'react';

// ═════════════════════════════════════════════════════════════════════════════
// WHAT THE FEED SHOWS — "of whom" (the club, a pack, mine, favourites, the
// academy) and "what" (everything, runs, updates). One small store, because the
// control lives in the Header (the club logo opens it, feed redesign
// 2026-10-12) and the list lives in the page. Remembered on the device: the two
// chip rows it replaces reset to "everyone" on every open.
// ═════════════════════════════════════════════════════════════════════════════

export type FeedKind = 'all' | 'runs' | 'social';
export interface FeedScope { kind: FeedKind; squad: string | null }

const KEY = 'mc:feedScope';
const DEFAULT: FeedScope = { kind: 'all', squad: null };
let state: FeedScope | null = null;
const listeners = new Set<() => void>();

function read(): FeedScope {
  if (state) return state;
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    state = v && ['all', 'runs', 'social'].includes(v.kind) ? { kind: v.kind, squad: typeof v.squad === 'string' ? v.squad : null } : DEFAULT;
  } catch {
    state = DEFAULT;
  }
  return state;
}

export function setFeedScope(patch: Partial<FeedScope>): void {
  state = { ...read(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: this visit only */ }
  listeners.forEach((l) => l());
}

export function resetFeedScope(): void { setFeedScope(DEFAULT); }

export function isDefaultScope(s: FeedScope): boolean { return s.kind === 'all' && !s.squad; }

export function useFeedScope(): FeedScope {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    read,
    () => DEFAULT,
  );
}
