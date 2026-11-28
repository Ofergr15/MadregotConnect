import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { createServerClient } from '@/lib/supabase/server';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { parseSelfReport } from '@/lib/academy/self-report';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const pending = (error: { message?: string } | null | undefined) =>
  !!error && (isMissingColumn(error) || isMissingTable(error) || /relation .* does not exist|academy_trainee_reports/.test(error.message || ''));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 62;
const validDate = (s: string | null): s is string =>
  !!s && DATE.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * GET /api/academy/self-report?from=YYYY-MM-DD&to=YYYY-MM-DD — the caller's OWN reports in
 * the range (academy-pack §2). SELF ONLY: identity is the verified caller; there is no
 * athleteId parameter. Range ≤ 62 days, inclusive. 503 migration_pending before 188.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ error: 'athlete account required' }, { status: 403 });
    const sp = new URL(request.url).searchParams;
    const from = sp.get('from');
    const to = sp.get('to');
    if (!validDate(from) || !validDate(to)) return NextResponse.json({ error: 'from and to must be YYYY-MM-DD' }, { status: 400 });
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days < 0) return NextResponse.json({ error: 'from must not be after to' }, { status: 400 });
    if (days + 1 > MAX_RANGE_DAYS) return NextResponse.json({ error: `range is at most ${MAX_RANGE_DAYS} days` }, { status: 400 });

    const { data, error } = await createServerClient()
      .from('academy_trainee_reports')
      .select('workout_date, activity_id, rpe, effort, pain, pain_area, pain_level, note')
      .eq('athlete_id', caller.athleteId)
      .gte('workout_date', from)
      .lte('workout_date', to)
      .order('workout_date', { ascending: true });
    if (pending(error)) return NextResponse.json({ error: 'migration_pending' }, { status: 503 });
    if (error) return NextResponse.json({ error: 'read failed', details: error.message }, { status: 500 });
    const reports = (data || []).map((r: any) => ({
      workoutDate: r.workout_date, activityId: r.activity_id ?? null, rpe: r.rpe, effort: r.effort ?? null,
      pain: !!r.pain, painArea: r.pain_area ?? null, painLevel: r.pain_level ?? null, note: r.note ?? '',
    }));
    return NextResponse.json({ reports });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'self-report read failed' }, { status: 500 });
  }
}

/**
 * POST /api/academy/self-report — the trainee's RPE / effort / pain for one workout.
 * SELF ONLY: identity is the verified caller; staff cannot write a trainee's report and
 * any athleteId in the body is ignored. 503 migration_pending before 188.
 * Same-day edit (academy-pack §3): a report that already exists for a day before today
 * (Israel) is 409 `locked`; a FIRST report for a past day is still accepted.
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
    if (r.workoutDate < israelToday()) {
      const { data: existing, error: readErr } = await supabase
        .from('academy_trainee_reports')
        .select('workout_date')
        .eq('athlete_id', caller.athleteId)
        .eq('workout_date', r.workoutDate)
        .maybeSingle<{ workout_date: string }>();
      if (pending(readErr)) return NextResponse.json({ error: 'migration_pending' }, { status: 503 });
      if (existing?.workout_date) return NextResponse.json({ error: 'locked' }, { status: 409 });
    }
    const { error } = await supabase.from('academy_trainee_reports').upsert({
      athlete_id: caller.athleteId, workout_date: r.workoutDate, activity_id: r.activityId, rpe: r.rpe, effort: r.effort,
      pain: r.pain, pain_area: r.painArea, pain_level: r.painLevel, note: r.note, read_at: null,
    }, { onConflict: 'athlete_id,workout_date' });
    if (error) {
      if (pending(error)) return NextResponse.json({ error: 'migration_pending' }, { status: 503 });
      return NextResponse.json({ error: 'save failed', details: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'self-report failed' }, { status: 500 });
  }
}
