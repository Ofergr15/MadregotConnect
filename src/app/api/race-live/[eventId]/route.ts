import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { liveBoard } from '@/lib/race-live/server';

export const dynamic = 'force-dynamic';

// GET the live board. Any verified member with race_live ON (staff always). Off → {enabled:false},
// which the tab renders as the pre-race content it already has.
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  try {
    const db = createServerClient();
    const on = caller.isStaff || caller.isSuperUser || (await isFeatureEnabled('race_live', caller.athleteId, db));
    if (!on) return NextResponse.json({ enabled: false });
    const board = await liveBoard(db, eventId, caller.athleteId);
    return NextResponse.json({ enabled: true, ...board });
  } catch (error: any) {
    console.error('[api/race-live/[eventId]]', error);
    return NextResponse.json({ error: 'board failed' }, { status: 500 });
  }
}
