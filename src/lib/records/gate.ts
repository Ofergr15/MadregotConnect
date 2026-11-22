import { NextResponse } from 'next/server';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';

/**
 * Member + `records_tab` flag. Flag off answers 200 `{ enabled: false }` (not a
 * 403), the same "a state the client already renders" rule as the verdict gate.
 */
export async function recordsGate(request: Request): Promise<
  { out: Response; caller?: undefined } | { out: null; caller: VerifiedCaller }
> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { out: denied };
  if (!(await isFeatureEnabled('records_tab', caller.athleteId))) {
    return { out: NextResponse.json({ enabled: false }) };
  }
  return { out: null, caller };
}
