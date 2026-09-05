'use client';

/**
 * Per-user map display preferences — currently just "colour routes by pace".
 *
 * Deliberately **device-local** (`localStorage`) rather than a column on
 * `athletes`:
 *
 *  - It changes nothing on the server. Nothing renders differently for anyone
 *    else, no job reads it, and no email depends on it — it decides how one
 *    person's own screen draws a line.
 *  - Migrations here are applied by hand in the Supabase SQL editor, so a new
 *    column means the setting silently doesn't stick until someone remembers to
 *    run it. A display toggle that quietly fails to save is worse than one that
 *    only follows you on the phone you set it on — and the club reads this app
 *    as an installed PWA on one phone each.
 *
 * The trade-off, stated plainly: set it on a phone and the desktop won't know.
 * If that ever matters, this is the seam to move server-side — every consumer
 * goes through `useMapPrefs`, so it's an edit to this file.
 *
 * Reads happen in an effect, never during render: these components are
 * server-rendered first, and a lazy `useState` initialiser touching
 * `localStorage` is a hydration mismatch.
 */

import { useCallback, useEffect, useState } from 'react';

export interface MapPrefs {
  /** Garmin-style pace heat map on every route map, instead of one flat colour. */
  paceColors: boolean;
}

export const MAP_PREFS_DEFAULTS: MapPrefs = { paceColors: false };

const STORAGE_KEY = 'madregot:map-prefs';

/**
 * `storage` only fires in *other* tabs, and the setting is toggled from Settings
 * while a map may be mounted on the same page (or on a screen behind it). This
 * custom event is what keeps them in step in the tab doing the writing.
 */
const CHANGE_EVENT = 'madregot:map-prefs';

function read(): MapPrefs {
  if (typeof window === 'undefined') return MAP_PREFS_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return MAP_PREFS_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<MapPrefs> | null;
    return { paceColors: !!parsed?.paceColors };
  } catch {
    // Private-mode Safari throws on localStorage, and a half-written value
    // shouldn't cost anyone a map. Defaults are always a valid answer.
    return MAP_PREFS_DEFAULTS;
  }
}

/**
 * `[prefs, setPrefs]`, where the setter takes a patch and persists it.
 *
 * Every mounted consumer updates on the same tick as the write, so the toggle in
 * Settings and a map already on screen never show different states.
 */
export function useMapPrefs(): [MapPrefs, (patch: Partial<MapPrefs>) => void] {
  const [prefs, setPrefsState] = useState<MapPrefs>(MAP_PREFS_DEFAULTS);

  useEffect(() => {
    setPrefsState(read());
    const sync = () => setPrefsState(read());
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const setPrefs = useCallback((patch: Partial<MapPrefs>) => {
    const next = { ...read(), ...patch };
    // Optimistic: the UI must not wait on storage, which can throw.
    setPrefsState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Unwritable storage means the choice lasts for this session only. Still
      // better than refusing the tap.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [prefs, setPrefs];
}
