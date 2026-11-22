/**
 * GET /api/activities/stream?activityId=<uuid>
 *
 * The run page's charts: the 1 Hz Garmin trace re-sampled onto ~400 points of an
 * even distance grid, the true kilometre splits cut from it, time in each HR zone,
 * and the watch's laps. ~15 KB, against the 2,000-7,000 raw samples it is read from.
 *
 * `{ stream: null }` when the run has no trace (Strava-only, treadmill, synced before
 * migration 094) — the page then draws the per-km splits from /api/activities/details.
 *
 * Visibility follows /api/activities/details: any verified club member, because the
 * route itself already is. The one new exposure is the heart-rate LINE, gated by
 * `mayViewHrTrace`: the runner and staff always; teammates only while the runner's
 * switch (migration 147) is on and the run's heart rate isn't hidden in the share
 * sheet. Without it the response carries no `hr` series and no zones. Per-km and
 * per-lap averages stay: teammates have always seen those (/api/activities/details).
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hiddenFromCaller } from '@/lib/athletes/test-accounts';
import { loadActivityStream } from '@/lib/garmin/stream-store';
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { streamHrZones, streamKmSplits, streamView } from '@/lib/activities/stream-view';
import { mayViewHrTrace, readHrTracePublic } from '@/lib/athletes/hr-trace-privacy';
import { DEFAULT_MAX_HR } from '@/components/activity/format';
import { readHiddenStats, type MaskedStat } from '@/lib/activities/hidden-stats';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const activityId = new URL(request.url).searchParams.get('activityId');
    if (!activityId || !/^[0-9a-f-]{36}$/i.test(activityId)) {
      return NextResponse.json({ error: 'activityId (uuid) required' }, { status: 400 });
    }

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const { data: row, error } = await supabase
      .from('athlete_activities')
      .select('id, athlete_id, max_hr')
      .eq('id', activityId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    if (row.athlete_id && (await hiddenFromCaller(supabase, caller, row.athlete_id))) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const stream = await loadActivityStream(supabase, row.id);
    if (!stream) return NextResponse.json({ stream: null });

    const selfOrStaff = mayActFor(caller, row.athlete_id);
    let hrVisible = true;
    // Stats the runner hid in the share sheet. Read once; a failed read hides them all
    // (lib/activities/hidden-stats). The runner and staff are never masked.
    let hidden = new Set<MaskedStat>();
    if (!selfOrStaff) {
      const [runnerAllows, hiddenStats] = await Promise.all([
        readHrTracePublic(supabase, row.athlete_id),
        readHiddenStats(supabase, row.id),
      ]);
      hidden = hiddenStats;
      hrVisible = mayViewHrTrace({ isSelfOrStaff: false, runnerAllows, hiddenOnThisRun: hidden.has('heart_rate') });
    }
    const hidePace = hidden.has('pace');
    const hideHr = hidden.has('heart_rate');

    const series = stream.series;
    const built = streamView(series, { includeHr: hrVisible });
    if (!built) return NextResponse.json({ stream: null });
    // Hidden pace: no pace line, and no elapsed-time axis (time over the shared distance
    // axis is the pace). The distance axis, elevation and cadence stay.
    const view = hidePace ? { ...built, t: [], pace: built.pace.map(() => null) } : built;

    const maxHr = Math.max(DEFAULT_MAX_HR, row.max_hr ?? 0);
    // Per-km and per-lap averages follow the same hidden stats: a split's or lap's
    // duration is its pace, so it goes with pace; distance stays.
    const kmSplits = streamKmSplits(series).map((k) => ({
      ...k,
      ...(hidePace ? { duration: null, pace: null } : {}),
      ...(hideHr ? { hr: null } : {}),
    }));
    const laps = normalizeStoredLaps(stream.laps).map(l => ({
      distance: Math.round(l.distance),
      duration: hidePace ? null : Math.round(l.duration),
      pace: hidePace ? null : l.averagePace,
      hr: hideHr ? null : l.averageHR,
      intensity: l.intensityType ?? null,
    }));

    return NextResponse.json({
      stream: view,
      kmSplits,
      laps,
      zones: hrVisible ? streamHrZones(series, maxHr) : null,
      maxHr,
      hrVisible,
    }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (error) {
    console.error('activities/stream failed:', error);
    return NextResponse.json({ error: 'Failed to load the trace' }, { status: 500 });
  }
}
