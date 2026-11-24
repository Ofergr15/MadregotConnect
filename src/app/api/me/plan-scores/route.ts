import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { loadFeedPlanVerdicts, type VerdictActivityRow } from '@/lib/feed/plan-verdicts';
import { readHiddenFields } from '@/lib/feed/project';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';
import { addDaysToDateStr, planWeekStartOf } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/me/plan-scores?weekStart=YYYY-MM-DD
//   -> { weekStart, scores: [{ activityId, score, paceStatus, paceHidden? }] }
//
// The plan score ("N% מהתוכנית") for each of the CALLER's own runs in one plan week
// (Sunday anchor), so the native Week screen need not read the whole feed for it.
// Read-only and, for now, called by nothing.
//
// Grading is `loadFeedPlanVerdicts` — the very function the feed uses — so this can
// never be a second answer for the same run. Its viewer is the caller as a plain
// athlete (isStaff: false): the route is "me", and the loader's own self-filter is
// then a second guard behind the athlete_id filter on the query.
//
// Masked under `payload.hiddenFields` 'pace' exactly as project.ts drops the feed's
// `planVerdict`: a run whose pace the athlete hid gets no score. A failed read of
// those flags hides every score (unknown never publishes), as the stats route does.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;

  const raw = new URL(request.url).searchParams.get('weekStart');
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: 'weekStart must be YYYY-MM-DD' }, { status: 400 });
  }
  const weekStart = planWeekStartOf(raw || undefined);
  const athleteId = caller.athleteId;
  // A staff account with no athletes row has no runs of its own.
  if (!athleteId || !mayActFor(caller, athleteId)) return NextResponse.json({ weekStart, scores: [] });

  try {
    const supabase = createServerClient();
    const weekEnd = addDaysToDateStr(weekStart, 7);
    const { data, error } = await supabase
      .from('athlete_activities')
      .select('id, athlete_id, activity_type, start_time, distance, duration, moving_duration, average_pace, laps')
      .eq('athlete_id', athleteId)
      .in('activity_type', PR_RUN_TYPES)
      .gte('start_time', `${weekStart}T00:00:00`)
      .lt('start_time', `${weekEnd}T00:00:00`)
      .order('start_time', { ascending: true })
      .order('id');
    if (error) return NextResponse.json({ error: 'Failed to load', details: error.message }, { status: 500 });
    const rows = (data || []) as VerdictActivityRow[];
    if (rows.length === 0) return NextResponse.json({ weekStart, scores: [] });

    const ids = rows.map(r => r.id);
    const [verdicts, hiddenPace] = await Promise.all([
      loadFeedPlanVerdicts(supabase, rows, { athleteId, isStaff: false }),
      paceHiddenFor(supabase, ids),
    ]);

    const scores = rows.map(r => {
      if (hiddenPace.has(r.id)) return { activityId: r.id, score: null, paceStatus: null, paceHidden: true };
      const v = verdicts.get(r.id);
      return { activityId: r.id, score: v?.score ?? null, paceStatus: v?.direction ?? null };
    });
    return NextResponse.json({ weekStart, scores });
  } catch (err: any) {
    console.error('[me/plan-scores] failed:', err);
    return NextResponse.json({ error: err?.message || 'Failed to load' }, { status: 500 });
  }
}

/** Activity ids whose feed item hides pace. Fails closed: on error, all of them. */
async function paceHiddenFor(supabase: ReturnType<typeof createServerClient>, ids: string[]): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from('feed_items').select('activity_id, payload').in('activity_id', ids);
    if (error) return new Set(ids);
    const out = new Set<string>();
    for (const f of (data || []) as Array<{ activity_id: string; payload: Record<string, unknown> | null }>) {
      if (readHiddenFields(f.payload).has('pace')) out.add(f.activity_id);
    }
    return out;
  } catch {
    return new Set(ids);
  }
}
