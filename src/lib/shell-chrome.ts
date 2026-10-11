'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * A screen that brings its own top row can fold the shell's phone header away while it is
 * mounted — the academy trainee's home (mockup trainee-experience-v2, phone 1: one row with
 * the greeting, 💬 and 🔔, not the app header above a second row). The shell
 * (app/(app)/layout.tsx) reads it; the desktop header is never hidden.
 *
 * A module-level flag with a subscriber set, not a context: the layout and the screen are
 * siblings across PageTransition, and the flag must drop the moment the screen unmounts.
 */

let hidden = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Is the phone header folded away right now? */
export function useShellHeaderHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden > 0, () => false);
}

/** Fold the phone header away while this component is mounted and `active`. */
export function useHideShellHeader(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    hidden += 1;
    emit();
    return () => {
      hidden -= 1;
      emit();
    };
  }, [active]);
}
