import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { createServerClient } from '@/lib/supabase/server';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { parseSelfReport } from '@/lib/academy/self-report';

export const dynamic = 'force-dynamic';

/**
 * POST /api/academy/self-report — the trainee's RPE / effort / pain for one workout.
 * SELF ONLY: identity is the verified caller; staff cannot write a trainee's report and
 * any athleteId in the body is ignored. 503 migration_pending before 188.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ error: 'athlete account required' }, { status: 403 });
    const parsed = parseSelfReport(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const r = parsed.report;
    const supabase = createServerClient();
    const { data: me } = await supabase.from('athletes').select('is_academy').eq('id', caller.athleteId).maybeSingle<{ is_academy: boolean | null }>();
    if (!me?.is_academy) return NextResponse.json({ error: 'academy trainees only' }, { status: 403 });
    const { error } = await supabase.from('academy_trainee_reports').upsert({
      athlete_id: caller.athleteId, workout_date: r.workoutDate, activity_id: r.activityId, rpe: r.rpe, effort: r.effort,
      pain: r.pain, pain_area: r.painArea, pain_level: r.painLevel, note: r.note, read_at: null,
    }, { onConflict: 'athlete_id,workout_date' });
    if (error) {
      if (isMissingColumn(error) || /relation .* does not exist|academy_trainee_reports/.test(error.message || '')) {
        return NextResponse.json({ error: 'migration_pending' }, { status: 503 });
      }
      console.error('[api/academy/self-report]', error);
      return NextResponse.json({ error: 'save failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[api/academy/self-report]', error);
    return NextResponse.json({ error: 'self-report failed' }, { status: 500 });
  }
}
