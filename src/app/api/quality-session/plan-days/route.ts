import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { COACH_ID } from '@/lib/constants';
import { loadPlanDays, planWorkoutLists } from '@/lib/quality-session/server';
import { PLAN_DAYS_KEY, weekQuality } from '@/lib/quality-session/plan-days';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isSunday = (d: string) => DATE.test(d) && new Date(`${d}T12:00:00Z`).getUTCDay() === 0;

// GET /api/quality-session/plan-days?week=YYYY-MM-DD (the plan week's Sunday)
//   -> { auto, suggested, days, manual } — the week's quality days: what the
//      latest uploaded plan says, the days that look like one but were not
//      detected, and the ones that count (the pick when there is one).
// PUT { week, days: number[] | null } -> the same, after saving. null drops the
//   pick, so the week goes back to what the plan says.
//
// Super user only, like the special-day mark: the pick decides the 7:30 push
// and the feed row for every story editor.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isSuperUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const week = new URL(request.url).searchParams.get('week') || '';
  if (!isSunday(week)) return NextResponse.json({ error: 'week must be a Sunday, YYYY-MM-DD' }, { status: 400 });

  try {
    return NextResponse.json(await load(createServerClient(), week));
  } catch (err) {
    console.error('[quality-session/plan-days] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isSuperUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const week = typeof body?.week === 'string' ? body.week : '';
  if (!isSunday(week)) return NextResponse.json({ error: 'week must be a Sunday, YYYY-MM-DD' }, { status: 400 });
  const days = body?.days === null ? null
    : Array.isArray(body?.days) && body.days.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
      ? [...new Set(body.days as number[])].sort() : undefined;
  if (days === undefined) return NextResponse.json({ error: 'days must be a list of 0–6, or null' }, { status: 400 });

  try {
    const supabase = createServerClient();
    // Kept to the last ten weeks: nothing reads a pick older than the screen's history.
    const floor = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
    const all = await loadPlanDays(supabase);
    const kept = Object.fromEntries(Object.entries(all).filter(([w]) => w !== week && w >= floor));
    if (days) kept[week] = days;
    const { error } = await supabase.from('app_settings').upsert(
      { key: PLAN_DAYS_KEY, value: JSON.stringify(kept), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (error) throw error;
    return NextResponse.json(await load(supabase, week));
  } catch (err) {
    console.error('[quality-session/plan-days] PUT failed:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

async function load(supabase: ReturnType<typeof createServerClient>, week: string) {
  const [plan, picks] = await Promise.all([
    supabase.from('weekly_plans').select('parsed_workouts')
      .eq('coach_id', COACH_ID).eq('week_start_date', week)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    loadPlanDays(supabase),
  ]);
  if (plan.error) throw plan.error;
  return weekQuality(planWorkoutLists(plan.data?.parsed_workouts ?? null), picks[week]);
}
