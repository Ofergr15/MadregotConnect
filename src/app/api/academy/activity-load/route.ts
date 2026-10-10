import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { activityLocalDateStr, israelToday } from '@/lib/utils';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { activityBreakdown, LOAD_VERSION, MAX_HR_DAYS, shiftDate } from '@/lib/academy/load';
import { ACTIVITY_LOADS_TABLE, BACKFILL_DAYS, hasActivityLoadsTable, loadTestsFor, maxHrNow, rhrOn } from '@/lib/academy/load-server';

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
      .select('id, athlete_id, start_time, activity_type, distance, duration, moving_duration, average_hr, max_hr, laps, splits')
      .eq('id', activityId)
      .eq('athlete_id', athleteId)
      .maybeSingle();
    if (error) throw error;
    if (!act) return NextResponse.json({ error: 'activity not found' }, { status: 404 });

    const date = activityLocalDateStr((act as any).start_time);
    const today = israelToday();
    // The same mornings ensureActivityLoads reads, so the sheet and the stored row agree.
    const [testsBy, nightsRes, historyRes] = await Promise.all([
      loadTestsFor(supabase, [athleteId]),
      supabase
        .from('athlete_wellness')
        .select('date, resting_hr')
        .eq('athlete_id', athleteId)
        .gte('date', shiftDate(today, -BACKFILL_DAYS - 30))
        .order('date', { ascending: true }),
      supabase
        .from('athlete_activities')
        .select('start_time, activity_type, max_hr')
        .eq('athlete_id', athleteId)
        .gte('start_time', `${shiftDate(today, -MAX_HR_DAYS)}T00:00:00Z`),
    ]);
    const nights = ((nightsRes.error ? [] : nightsRes.data) || []).map((n: any) => ({ date: String(n.date).slice(0, 10), resting_hr: n.resting_hr ?? null }));
    const history = ((historyRes.error ? [] : historyRes.data) || []) as any[];

    const breakdown = activityBreakdown(act as any, {
      tests: testsBy[athleteId] || [],
      rhr: rhrOn(nights, date),
      maxHr: maxHrNow(history, today),
    });

    // Keep the stored row in step with what the sheet shows (view-as writes nothing).
    if (!caller.viewingAsBy && (await hasActivityLoadsTable(supabase))) {
      const { error: upErr } = await supabase.from(ACTIVITY_LOADS_TABLE).upsert({
        activity_id: activityId,
        athlete_id: athleteId,
        activity_date: date,
        load: breakdown.load,
        source: breakdown.source,
        threshold_sec: breakdown.thresholdSec,
        basis_test_date: breakdown.basisTestDate,
        formula_version: LOAD_VERSION,
        computed_at: new Date().toISOString(),
      }, { onConflict: 'activity_id' });
      if (upErr) console.error('activity_loads upsert failed:', upErr);
    }

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
