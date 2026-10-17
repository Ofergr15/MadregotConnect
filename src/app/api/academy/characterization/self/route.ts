import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { coachIdsOf } from '@/lib/academy/trainee-coaches';
import { notifyAthlete } from '@/lib/push';
import { academyQuestionsAnsweredCopy } from '@/lib/notifications/copy';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The trainee's own "4 questions" (mockup t5) — the part of the characterization call an
 * existing trainee never had: which days they can train, roughly how many km a week, and any
 * limitations. (The fourth, the goal, is the goal module's own screen.)
 *
 * GET: what is on record, and a weekly-km suggestion from their own last four weeks of runs.
 * PUT `{ availableDays, weeklyKm, limitations }`: written onto THEIR card's characterization —
 * the same row the call fills in, so the plan composer reads it unchanged. A trainee with no
 * card gets one that says 'existing' (they are in the academy; the funnel counts them joined).
 *
 * The caller's own answers only: this is not a way into anybody else's characterization, which
 * stays staff-only (it holds the coach's private fit verdict).
 */

async function self(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  if (!caller.athleteId) return { denied: NextResponse.json({ error: 'No athlete' }, { status: 403 }) };
  const supabase = createServerClient();
  const { data: me } = await supabase.from('athletes').select('id, name, is_academy, academy_coach_id').eq('id', caller.athleteId).eq('coach_id', COACH_ID).maybeSingle();
  if (!me || !(me as { is_academy?: boolean }).is_academy) return { denied: NextResponse.json({ error: 'Not in the academy' }, { status: 404 }) };
  return { caller, supabase, me: me as { id: string; name: string; academy_coach_id: string | null } };
}

/** Average km over the last four whole weeks (Sunday weeks), from their own runs. */
async function recentWeeklyKm(supabase: ReturnType<typeof createServerClient>, athleteId: string): Promise<number | null> {
  const today = israelToday();
  const d = new Date(`${today}T12:00:00Z`);
  const weekStart = new Date(d.getTime() - d.getUTCDay() * 86_400_000);
  const from = new Date(weekStart.getTime() - 28 * 86_400_000).toISOString().slice(0, 10);
  const to = weekStart.toISOString().slice(0, 10);
  const { data } = await supabase.from('athlete_activities').select('distance, start_time')
    .eq('athlete_id', athleteId).gte('start_time', `${from}T00:00:00Z`).lt('start_time', `${to}T00:00:00Z`).limit(200);
  const meters = ((data || []) as Array<{ distance: number | null }>).reduce((s, a) => s + (Number(a.distance) || 0), 0);
  return meters > 0 ? Math.round(meters / 1000 / 4) : null;
}

export async function GET(request: Request) {
  try {
    const s = await self(request);
    if (s.denied) return s.denied;
    const { supabase, me } = s;
    const { data: card } = await supabase.from('academy_candidates').select('id').eq('athlete_id', me.id).maybeSingle();
    let answers = { availableDays: [] as number[], weeklyKm: null as number | null, limitations: null as string | null };
    if (card) {
      const { data: c, error } = await supabase.from('academy_characterizations').select('available_days, weekly_km, limitations').eq('candidate_id', (card as { id: string }).id).maybeSingle();
      if (!error && c) {
        const row = c as { available_days?: number[] | null; weekly_km?: number | null; limitations?: string | null };
        answers = { availableDays: row.available_days ?? [], weeklyKm: row.weekly_km != null ? Number(row.weekly_km) : null, limitations: row.limitations ?? null };
      }
    }
    const answered = answers.availableDays.length > 0 && answers.weeklyKm != null;
    return NextResponse.json({ ...answers, answered, suggestedWeeklyKm: await recentWeeklyKm(supabase, me.id) });
  } catch (err) {
    console.error('GET /api/academy/characterization/self error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const s = await self(request);
    if (s.denied) return s.denied;
    const { supabase, me, caller } = s;
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    const days = Array.isArray(b.availableDays)
      ? [...new Set(b.availableDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
      : [];
    const km = Number(b.weeklyKm);
    const weeklyKm = b.weeklyKm != null && b.weeklyKm !== '' && Number.isFinite(km) && km >= 0 && km <= 400 ? Math.round(km * 10) / 10 : null;
    const limitations = typeof b.limitations === 'string' && b.limitations.trim() ? b.limitations.trim().slice(0, 500) : null;
    if (!days.length) return NextResponse.json({ error: 'availableDays is required', fields: ['availableDays'] }, { status: 400 });
    if (weeklyKm == null) return NextResponse.json({ error: 'weeklyKm is required', fields: ['weeklyKm'] }, { status: 400 });

    let { data: card } = await supabase.from('academy_candidates').select('id').eq('athlete_id', me.id).maybeSingle();
    if (!card) {
      const ins = await supabase.from('academy_candidates').insert({ name: me.name || '—', source: 'existing', athlete_id: me.id, accepted_at: new Date().toISOString() }).select('id').single();
      if (ins.error) {
        return isMissingTable(ins.error)
          ? NextResponse.json({ error: 'The academy funnel is not set up yet', tableMissing: true }, { status: 503 })
          : NextResponse.json({ error: 'Failed to save' }, { status: 500 });
      }
      card = ins.data;
    }
    const candidateId = (card as { id: string }).id;
    const { error } = await supabase.from('academy_characterizations').upsert({
      candidate_id: candidateId, available_days: days, weekly_km: weeklyKm, limitations,
      recorded_by: caller.email || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'candidate_id' });
    if (error) {
      return isMissingTable(error)
        ? NextResponse.json({ error: 'Characterizations are not set up yet', tableMissing: true }, { status: 503 })
        : NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
    // Their coaches see it in "מחכה לך" (mockup c1) — one push each, replaced if answered again.
    try {
      const coaches = (await coachIdsOf(supabase, me.id, me.academy_coach_id)).filter((c) => c && c !== me.id);
      await Promise.allSettled(coaches.map((coachId) => notifyAthlete({
        athleteId: coachId, kind: 'academy_questions_answered', actorAthleteId: me.id,
        copy: (locale) => academyQuestionsAnsweredCopy(locale, { name: me.name, days, weeklyKm, limitations }),
        url: '/dashboard/academy?tab=members', tag: `academy-questions-${me.id}`,
      })));
    } catch { /* the answers are saved; the message is best-effort */ }
    return NextResponse.json({ availableDays: days, weeklyKm, limitations, answered: true });
  } catch (err) {
    console.error('PUT /api/academy/characterization/self error:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
