'use client';

// The new install guide (components/install) is tried before everyone gets it:
// the super user sees it, and so does any device that opened a link with
// `?onb=v2` — which is how it is tried as a brand-new member, on a phone that
// has no session at all. The switch itself is lib/install/flag.ts.

import { useEffect, useState } from 'react';
import { useIsSuperUser } from '@/lib/impersonation';

import { ONBOARDING_V2_FOR_ALL } from './flag';

export { ONBOARDING_V2_FOR_ALL };
export const ONBOARDING_V2_KEY = 'mc-onb-v2';

/** Reads (and remembers) the `?onb=v2` / `?onb=off` switch. */
export function previewOnboardingV2(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('onb');
    if (q === 'v2') localStorage.setItem(ONBOARDING_V2_KEY, '1');
    if (q === 'off') localStorage.removeItem(ONBOARDING_V2_KEY);
    return localStorage.getItem(ONBOARDING_V2_KEY) === '1';
  } catch {
    return false;
  }
}

/** For pages with no session (/join): the switch alone. */
export function usePreviewOnboardingV2(): boolean {
  const [on, setOn] = useState(ONBOARDING_V2_FOR_ALL);
  useEffect(() => { if (!ONBOARDING_V2_FOR_ALL) setOn(previewOnboardingV2()); }, []);
  return on;
}

/** Inside the app: the super user too. */
export function useOnboardingV2(): boolean {
  const superUser = useIsSuperUser();
  const preview = usePreviewOnboardingV2();
  return ONBOARDING_V2_FOR_ALL || superUser || preview;
}
