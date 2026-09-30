import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isPendingAthlete, seesPending } from '@/lib/auth/pending-athletes';
import { buildRangeRuns, parseRunsRange } from '@/lib/athletes/runs-range';

export const dynamic = 'force-dynamic';

// GET /api/athletes/[id]/runs?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// One week's or one month's runs, for the profile's "weeks" and "calendar" views.
// Nothing here is new to the caller: /stats beside it already hands any member
// this athlete's runs (name, date, km, pace), and the feed already ships the same
// route preview on every card. What this adds is a window further back than the
// newest thirty.
//
// Super user only while the two views are tried out, like the screen that asks.
// At rollout this becomes /stats's gate, and no wider: a member, and a pending
// runner's runs only to themselves and staff.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const range = parseRunsRange(searchParams.get('from'), searchParams.get('to'));
    if (!range) return NextResponse.json({ error: 'from and to are required, at most 42 days apart' }, { status: 400 });

    const supabase = createServerClient();
    if (!seesPending(caller, id) && (await isPendingAthlete(supabase, id))) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('athlete_activities')
      .select('id, activity_name, activity_type, start_time, distance, duration, route_preview')
      .eq('athlete_id', id)
      .gte('start_time', range.from)
      .lt('start_time', range.to)
      .order('start_time', { ascending: false });
    if (error) throw error;

    return NextResponse.json({ runs: buildRangeRuns(data ?? []) });
  } catch (error) {
    console.error('Failed to fetch athlete runs:', error);
    return NextResponse.json({ error: 'Failed to fetch athlete runs' }, { status: 500 });
  }
}
