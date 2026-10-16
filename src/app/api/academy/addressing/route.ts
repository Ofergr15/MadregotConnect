import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { mayCoach } from '@/lib/academy/pairing-server';
import { parseAddressing } from '@/lib/academy/addressing';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/academy/addressing — how the app speaks to a trainee: `{ athleteId, gender }`,
 * gender 'male' | 'female' | null (null = not known, which keeps today's default wording).
 *
 * The form does not ask (Ofer, launch T5: "the managers and coaches know it from the intro
 * call"), so staff set it on the trainee's card. It is the profile's own `athletes.gender`
 * (migration 057), the one column every gendered sentence already reads, so the trainee's
 * own profile, the watch/Strava auto-fill and this card all write the same answer.
 *
 * Who: the manager (any club athlete, including a candidate who is not in the academy yet) or
 * one of the trainee's coaches (`mayCoach`). Anyone else gets a 404, as the goal route does.
 */
export async function PUT(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const parsed = parseAddressing(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { athleteId, gender } = parsed;
    if (!(await mayCoach(caller, athleteId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('athletes')
      .update({ gender })
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID)
      .select('id, gender')
      .maybeSingle();
    if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ athleteId, gender: (data as { gender: string | null }).gender ?? null });
  } catch (err) {
    console.error('PUT /api/academy/addressing error:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
