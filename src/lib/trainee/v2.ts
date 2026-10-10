'use client';

// The trainee experience v2 is tried before every trainee gets it: the super user sees
// it, and so does any device that opened a link with `?tv=2` — which is how it is tried
// on a trainee's own phone. `?tv=off` turns it back off for that device. The switch
// itself is lib/trainee/flag.ts. The same idiom as lib/install/v2.ts.

import { useEffect, useState } from 'react';
import { useIsSuperUser } from '@/lib/impersonation';

import { TRAINEE_V2_FOR_ALL } from './flag';

export { TRAINEE_V2_FOR_ALL };
export const TRAINEE_V2_KEY = 'mc-trainee-v2';

/** Reads (and remembers) the `?tv=2` / `?tv=off` switch. */
export function previewTraineeV2(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('tv');
    if (q === '2') localStorage.setItem(TRAINEE_V2_KEY, '1');
    if (q === 'off') localStorage.removeItem(TRAINEE_V2_KEY);
    return localStorage.getItem(TRAINEE_V2_KEY) === '1';
  } catch {
    return false;
  }
}

/** The flag, the super user, or this device's `?tv=2`. */
export function useTraineeV2(): boolean {
  const superUser = useIsSuperUser();
  const [preview, setPreview] = useState(TRAINEE_V2_FOR_ALL);
  useEffect(() => { if (!TRAINEE_V2_FOR_ALL) setPreview(previewTraineeV2()); }, []);
  return TRAINEE_V2_FOR_ALL || superUser || preview;
}
