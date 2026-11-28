import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { loadRaceResults } from '@/lib/race-live/results';

export const dynamic = 'force-dynamic';

// GET → the post-race results data: one reconciled finish time per runner (Garmin activity >
// Strava activity > live finish split), every source next to it. Same gate as the live board:
// any verified member with race_live on (staff always); opted-out runners absent, except self.
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  try {
    const db = createServerClient();
    const on = caller.isStaff || caller.isSuperUser || (await isFeatureEnabled('race_live', caller.athleteId, db));
    if (!on) return NextResponse.json({ enabled: false });
    const results = await loadRaceResults(db, eventId, caller.athleteId);
    return NextResponse.json({ enabled: true, ...results });
  } catch (error: any) {
    console.error('race results failed', error);
    return NextResponse.json({ error: 'results failed' }, { status: 500 });
  }
}
