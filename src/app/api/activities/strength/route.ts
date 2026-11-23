import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { isStrengthType } from '@/lib/activities/kinds';
import { activeSets, exerciseCount, isMissingExerciseSetsColumn, type StrengthHr, type StrengthSet } from '@/lib/activities/strength';

export const dynamic = 'force-dynamic';

/**
 * GET /api/activities/strength?id=<athlete_activities.id> — one strength session, set by set.
 *
 * SELF-OR-STAFF (review-2026-11-20/strength/plan.md "פרטיות"): the sets carry personal weights.
 * A club member sees the feed card (counts only, lib/activities/strength-feed.ts), never this.
 * Behind `strength_training` for the caller. 404 for a non-strength row, so this route cannot
 * be used to read anything else about a run.
 */
/** Σ reps × kg over work sets; null when no set carries a weight (bodyweight session). */
function volumeKg(sets: StrengthSet[] | null): number | null {
  let v = 0; let any = false;
  for (const x of activeSets(sets)) if (x.weightKg != null && x.reps != null) { v += x.weightKg * x.reps; any = true; }
  return any ? Math.round(v) : null;
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const db = createServerClient();
    const { data: row, error } = await db.from('athlete_activities')
      .select('id, athlete_id, activity_type, activity_name, start_time, duration, average_hr, max_hr, calories, source')
      .eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: 'read failed', details: error.message }, { status: 500 });
    if (!row || !isStrengthType(row.activity_type)) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!mayActFor(caller, row.athlete_id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (!(await isFeatureEnabled('strength_training', caller.athleteId, db))) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Sets after the gate, in their own read: before migration 203 the column is missing and the
    // session still answers, with `sets: null` ("no set detail") rather than a 500.
    let sets: StrengthSet[] | null = null;
    let hr: StrengthHr | null = null;
    let sufferScore: number | null = null;
    const { data: s, error: sErr } = await db.from('athlete_activities').select('exercise_sets, strength_hr, suffer_score').eq('id', id).maybeSingle();
    if (!sErr) {
      sets = (s?.exercise_sets as StrengthSet[] | null) ?? null;
      hr = (s?.strength_hr as StrengthHr | null) ?? null;
      sufferScore = (s?.suffer_score as number | null) ?? null;
    } else if (!isMissingExerciseSetsColumn(sErr)) console.error('strength sets read failed', sErr.message);
    // training_effect is migration 160 (applied) — read apart so a missing 203 doesn't take it down.
    const { data: te } = await db.from('athlete_activities').select('training_effect').eq('id', id).maybeSingle();
    const trainingEffect = (te?.training_effect as { aerobic?: number | null; anaerobic?: number | null; label?: string | null; load?: number | null } | null) ?? null;

    // Previous strength session of the same athlete, for "+8% volume vs last time".
    let previous: { id: string; startTime: string; volumeKg: number | null; durationSec: number | null } | null = null;
    const { data: prev, error: pErr } = await db.from('athlete_activities').select('id, start_time, duration, exercise_sets')
      .eq('athlete_id', row.athlete_id).eq('activity_type', 'strength_training').lt('start_time', row.start_time)
      .order('start_time', { ascending: false }).limit(1).maybeSingle();
    if (!pErr && prev) previous = { id: prev.id, startTime: prev.start_time, durationSec: prev.duration ?? null, volumeKg: volumeKg(prev.exercise_sets as StrengthSet[] | null) };

    return NextResponse.json({
      session: {
        id: row.id,
        athleteId: row.athlete_id,
        name: row.activity_name,
        startTime: row.start_time,
        durationSec: row.duration ?? null,
        averageHr: row.average_hr ?? null,
        maxHr: row.max_hr ?? null,
        calories: row.calories ?? null,
        source: row.source ?? null,
        exercises: exerciseCount(sets),
        setCount: activeSets(sets).length,
        volumeKg: volumeKg(sets),
        trainingEffect: trainingEffect ? {
          aerobic: trainingEffect.aerobic ?? null, anaerobic: trainingEffect.anaerobic ?? null,
          label: trainingEffect.label ?? null, load: trainingEffect.load ?? null,
        } : null,
        sufferScore,
        sets,
        hr,
        previous,
      },
    });
  } catch (err: unknown) {
    console.error('GET /api/activities/strength error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
