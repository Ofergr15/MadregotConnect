import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { liveButton } from '@/lib/race-live/viewer';

export const dynamic = 'force-dynamic';

// GET → { button: 'live' | 'results' | null } for the event page's "צפייה חיה" button.
// Same gate as the board (staff always, else the race_live flag); the window rule is
// liveButton() in lib/race-live/viewer.ts. A cheap read so every event page can ask.
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return NextResponse.json({ button: null });
  try {
    const db = createServerClient();
    const on = caller.isStaff || caller.isSuperUser || (await isFeatureEnabled('race_live', caller.athleteId, db));
    if (!on) return NextResponse.json({ button: null });
    const { data: cfg } = await db.from('race_live_config').select('active, poll_from, poll_to').eq('event_id', eventId).maybeSingle();
    return NextResponse.json({ button: liveButton(cfg ?? null, true, Date.now()) });
  } catch {
    return NextResponse.json({ button: null });
  }
}
