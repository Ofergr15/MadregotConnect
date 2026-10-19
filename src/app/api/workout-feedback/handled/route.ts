import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { inScope, staffAthleteScope } from '@/lib/academy/staff-scope';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workout-feedback/handled { ids: string[] }
 *
 * A coach marks feedback answered: after writing to the runner (one message for all
 * of it), or with no message at all — "טופל בלי הודעה", say after a phone call (mockup
 * coach-feedback-mockup.html). Stamped as coach_reply_at with no reply text, which
 * lib/feedback/waiting.ts reads as answered. Only feedback the caller may see
 * (staffAthleteScope: an academy coach, their own trainees).
 */
export async function POST(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isSuperUser && !caller.isStaff) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
  if (!ids.length) return NextResponse.json({ error: 'ids required' }, { status: 400 });
  const supabase = createServerClient();
  const [scope, { data, error }] = await Promise.all([
    staffAthleteScope(supabase, caller),
    supabase.from('workout_feedback').select('id, athlete_id, coach_reply_at').in('id', ids),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const mine = inScope((data || []) as Array<{ id: string; athlete_id: string; coach_reply_at: string | null }>, scope, (r) => r.athlete_id);
  if (!mine.length) return NextResponse.json({ handled: 0 });
  const { error: upErr } = await supabase.from('workout_feedback')
    .update({ coach_reply_at: new Date().toISOString(), coach_reply_by: caller.email || null })
    .in('id', mine.map((r) => r.id));
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ handled: mine.length });
}
