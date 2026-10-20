'use client';

import { useApi } from '@/lib/api';

/**
 * Is the signed-in member one the required setup (components/setup/SetupGate) is for?
 * null while unknown. The older first-run asks — the install sheet, onboarding v2's
 * welcome and notifications step, the "connect Garmin" popup, the feed's checklist —
 * each ask again what the setup already asked, so for its members they stay off; for
 * everyone else nothing changes. Same request as the gate's, so SWR sends it once.
 */
export function useSetupCohort(): boolean | null {
  const { data, error } = useApi<{ applicable?: boolean }>('/api/setup');
  if (error) return false;
  return data ? data.applicable === true : null;
}
