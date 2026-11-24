import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { planWeekStartOf } from '@/lib/utils';
import { cleanMomentInput, isMomentKind } from '@/lib/academy/week-moments';
import { coachWeek, MomentsNotMigrated } from '@/lib/academy/week-moments-server';
import { traineeIdsOfCoach } from '@/lib/academy/trainee-coaches';

export const dynamic = 'force-dynamic';

/**
 * The coach's weekly moments (academy doc p.2–3; design/b22/academy-week/mockup-v3.html).
 *
 *   GET ?weekStart=YYYY-MM-DD   → { weekStart, recipients, moments[4] } — the caller's OWN moments, with a
 *                                 server-written draft where nothing is written yet (a draft never sends).
 *   PUT { weekStart, kind, body, goals?, notes? } → save the caller's moment (a draft until sent).
 *
 * WHO: staff with an athlete row. The author is ALWAYS the JWT caller; the audience is that caller's own
 * trainees (traineeIdsOfCoach). No body field names an author, a coach or a recipient list.
 */
export async function GET(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete identity' }, { status: 403 });
  try {
    const weekStart = planWeekStartOf(new URL(request.url).searchParams.get('weekStart'));
    return NextResponse.json(await coachWeek(createServerClient(), caller.athleteId, weekStart, new Date().toISOString()));
  } catch (e) {
    if (e instanceof MomentsNotMigrated) return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    console.error('GET /api/academy/week-moments', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete identity' }, { status: 403 });
  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isMomentKind(b.kind)) return NextResponse.json({ error: 'kind must be plan | prep_tue | prep_fri | summary' }, { status: 400 });
    const input = cleanMomentInput(b);
    if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 });
    const weekStart = planWeekStartOf(typeof b.weekStart === 'string' ? b.weekStart : null);
    const db = createServerClient();
    // A personal note may only name one of the caller's own trainees.
    const mine = new Set(await traineeIdsOfCoach(db, caller.athleteId));
    for (const id of Object.keys(input.notes)) if (!mine.has(id)) delete input.notes[id];
    const { data: existing, error: readErr } = await db.from('academy_week_moments')
      .select('id, sent_at').eq('week_start', weekStart).eq('kind', b.kind).eq('author_id', caller.athleteId).maybeSingle();
    if (readErr && /does not exist|schema cache/i.test(readErr.message || '')) return NextResponse.json({ error: 'migration 212 not applied', code: 'migration_pending' }, { status: 503 });
    if ((existing as { sent_at?: string | null } | null)?.sent_at) return NextResponse.json({ error: 'already sent', code: 'sent' }, { status: 409 });
    const now = new Date().toISOString();
    const row = { week_start: weekStart, kind: b.kind, author_id: caller.athleteId, body: input.body, goals: input.goals, notes: input.notes, updated_at: now };
    const { data, error } = await db.from('academy_week_moments').upsert(row, { onConflict: 'week_start,kind,author_id' }).select('id').single();
    if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    return NextResponse.json({ id: (data as { id: string }).id, saved: true });
  } catch (e) {
    console.error('PUT /api/academy/week-moments', e);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
