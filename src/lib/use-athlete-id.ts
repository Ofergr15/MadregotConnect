'use client';

import { useState } from 'react';

// ═════════════════════════════════════════════════════════════════════════════
// "Who am I?" — answered DURING the first render, not one commit later.
//
// Nearly every screen in the app needs this account's athlete id before it can
// ask the server for anything, and nearly every screen used to resolve it the
// same way:
//
//     const [athleteId, setAthleteId] = useState<string | null>(null);
//     useEffect(() => { setAthleteId(localStorage.getItem('athlete_id') || ''); }, []);
//     const { data } = useApi(athleteId ? `/api/…?athleteId=${athleteId}` : null);
//
// That costs one extra render, which is nothing. What it actually costs is the
// WARM CACHE: on the first render the SWR key is `null`, so there is no key to
// look up, so lib/swr-persist.ts has nothing to hand back — and the screen paints
// its spinner. The answer was on the device the whole time; the screen just
// wasn't asking a question yet. Reported as 41b26dca ("loading times of pages
// like notifications, and all of them roughly, aren't fast enough") and as
// 71806857 before it: not slow requests, a cache that couldn't be consulted.
//
// Reading localStorage in a lazy `useState` initializer runs during render, which
// is the whole point — the key is real on render #1, the persisted entry paints
// immediately, and SWR revalidates behind it.
//
// WHY THAT IS SAFE HERE, and the one rule for using it: this is only for screens
// inside the `(app)` shell. That layout holds a spinner until `authorized` flips
// in an effect (see src/app/(app)/layout.tsx), so nothing under it is ever
// server-rendered or hydrated — there is no server pass to disagree with. Do NOT
// reach for this in a component that renders on the server: `localStorage` is
// undefined there, and the `typeof window` guard below would then make the server
// and client disagree about the first paint, which is exactly the hydration
// mismatch the old effect was avoiding.
//
// Returns '' for "signed in but no athlete row" (staff that live only in the
// legacy `coaches` table) and for private mode — the same empty string the
// effect version settled on, so every `athleteId ? … : null` key still behaves.
// ═════════════════════════════════════════════════════════════════════════════

export function readAthleteId(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem('athlete_id') || '';
  } catch {
    return ''; // private mode / storage denied
  }
}

/**
 * This account's athlete id, known on the first render.
 *
 * `useState` rather than a bare call so the value is stable for the life of the
 * component: the id only ever changes by signing in or out, and both of those
 * reload the app. A bare read would re-run on every render for no benefit.
 */
export function useAthleteId(): string {
  const [athleteId] = useState(readAthleteId);
  return athleteId;
}
