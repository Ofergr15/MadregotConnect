import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { laneWorkouts } from '@/lib/academy/group-lane';
import { withLanePaces } from '@/lib/plans/story-lanes';
import { workoutStoryText } from '@/lib/plans/workout-story-text';
import type { WorkoutStep } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/plans/story?weekStart=YYYY-MM-DD&key=<workoutKey>&type=&km=&day=
 * The story text with all three packs' paces, from the club's plan for that week —
 * whatever lane the caller runs in (lib/plans/story-lanes). 404 when the week has no
 * club plan or the session isn't in it; the copy then falls back to the screen's text.
 */
export async function GET(request: Request) {
  const { denied } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const weekStart = q.get('weekStart') || '';
  const key = q.get('key') || '';
  const day = Number(q.get('day'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !key) return NextResponse.json({ error: 'weekStart and key' }, { status: 400 });
  const db = createServerClient();
  const { data } = await db.from('weekly_plans').select('parsed_workouts')
    .eq('coach_id', COACH_ID).eq('week_start_date', weekStart).is('athlete_id', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const parsed = (data as { parsed_workouts?: unknown } | null)?.parsed_workouts;
  if (!parsed) return NextResponse.json({ error: 'no plan' }, { status: 404 });
  const lanes = ([1, 2, 3] as const).map((lane) => {
    const w = laneWorkouts(parsed, lane).find((x) => (x as { workoutKey?: string }).workoutKey === key);
    return (w?.steps ?? null) as WorkoutStep[] | null;
  });
  const steps = withLanePaces(lanes);
  if (!steps) return NextResponse.json({ error: 'no session' }, { status: 404 });
  return NextResponse.json({
    text: workoutStoryText({ dayOfWeek: Number.isFinite(day) ? day : 0, type: q.get('type') || '', km: q.get('km') || '', steps }),
  });
}
