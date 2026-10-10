import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { israelToday } from '@/lib/utils';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { ACTIVITY_LOAD_COLUMNS, activityLoadBreakdown } from '@/lib/academy/load-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/activity-load?athleteId=…&activityId=…
 *
 * The ⚡ sheet (mockup 5ב): one activity's load, what priced it (pace against which test,
 * or heart rate), and the lines it is made of — grouped by the watch's workout step when
 * the laps carry one, else warmup / work / jog / cooldown by pace — rounded so they add
 * up to the number on the ⚡.
 *
 * WHO: `mayCoach`, as /api/academy/load. The activity must be the athlete's own.
 * Stores the priced row (migration 142) unless the caller is viewing as someone.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId') || '';
    const activityId = searchParams.get('activityId') || '';
    if (!athleteId || !activityId) {
      return NextResponse.json({ error: 'athleteId and activityId are required' }, { status: 400 });
    }

    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { data: act, error } = await supabase
      .from('athlete_activities')
      .select(ACTIVITY_LOAD_COLUMNS)
      .eq('id', activityId)
      .eq('athlete_id', athleteId)
      .maybeSingle();
    if (error) throw error;
    if (!act) return NextResponse.json({ error: 'activity not found' }, { status: 404 });

    // Priced from the same mornings ensureActivityLoads reads, and the stored row kept in
    // step with what the sheet shows (view-as writes nothing).
    const breakdown = await activityLoadBreakdown(supabase, athleteId, act as any, { write: !caller.viewingAsBy, today: israelToday() });

    return NextResponse.json({
      load: breakdown.load,
      source: breakdown.source,
      thresholdSec: breakdown.thresholdSec,
      basisTestDate: breakdown.basisTestDate,
      parts: breakdown.parts,
    });
  } catch (error: unknown) {
    console.error('Academy activity load error:', error);
    return NextResponse.json({ error: 'Failed to load the activity load' }, { status: 500 });
  }
}
