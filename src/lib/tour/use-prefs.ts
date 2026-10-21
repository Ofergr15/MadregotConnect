'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiHeaders, useApi } from '@/lib/api';
import { EMPTY_PREFS, mergePrefs, readLocal, writeLocal, type TourPrefs } from './prefs';

/**
 * This person's tour prefs: the server's (GET /api/tours) merged with the local copy, and a
 * `save` that writes both. `ready` once the server has answered — or failed, in which case
 * the local copy alone decides (an admin viewing somebody gets 403 on the POST; fine).
 */
export function useTourPrefs(enabled = true): { prefs: TourPrefs; ready: boolean; save: (change: { tour?: string; state?: string; hotspot?: string; reset?: string }) => void } {
  const { data, error, mutate } = useApi<TourPrefs>(enabled ? '/api/tours' : null);
  const [local, setLocal] = useState<TourPrefs>(EMPTY_PREFS);
  useEffect(() => { setLocal(readLocal()); }, []);
  const prefs = mergePrefs(data ?? EMPTY_PREFS, local);
  const save = useCallback((change: { tour?: string; state?: string; hotspot?: string; reset?: string }) => {
    const next = mergePrefs(readLocal(), EMPTY_PREFS);
    if (change.tour && change.state) next.tours[change.tour] = change.state;
    if (change.hotspot) next.hotspots[change.hotspot] = true;
    if (change.reset) delete next.tours[change.reset];
    writeLocal(next);
    setLocal(next);
    void (async () => {
      try {
        await fetch('/api/tours', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify(change) });
        void mutate();
      } catch { /* the local copy holds */ }
    })();
  }, [mutate]);
  return { prefs, ready: !!data || !!error, save };
}
