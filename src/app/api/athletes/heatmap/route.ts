import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// GET /api/athletes/heatmap?athleteId=…
// Day-by-day distance for the last ~53 weeks (GitHub-contribution-graph
// style activity/rest pattern) — every logged activity counts, unlike PRs
// this is not about race-qualifying runs, just "did you move that day."
// Auth mirrors /api/athletes/prs exactly: caller may fetch their own, staff
// may fetch any.
export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    let allowed = false;
    if (isSuperUser(email)) {
      allowed = true;
    } else if (email) {
      const { data: caller } = await supabase
        .from('athletes')
        .select('id, role')
        .eq('email', email)
        .maybeSingle();
      const isStaff = !!caller && ['coach', 'admin', 'academy_coach'].includes((caller as any).role);
      allowed = isStaff || (caller as any)?.id === athleteId;
    }
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const since = new Date();
    since.setDate(since.getDate() - 371);
    const { data: acts, error } = await supabase
      .from('athlete_activities')
      .select('start_time, distance')
      .eq('athlete_id', athleteId)
      .gte('start_time', since.toISOString())
      .order('start_time', { ascending: true });
    if (error) throw error;

    const metersByDay = new Map<string, number>();
    for (const a of acts || []) {
      const day = String(a.start_time).slice(0, 10);
      metersByDay.set(day, (metersByDay.get(day) || 0) + (a.distance || 0));
    }
    const days = Array.from(metersByDay.entries()).map(([date, meters]) => ({
      date,
      km: Math.round((meters / 1000) * 10) / 10,
    }));

    return NextResponse.json({ days });
  } catch (err: any) {
    console.error('Heatmap error:', err);
    return NextResponse.json({ error: err.message || 'Failed to compute heatmap' }, { status: 500 });
  }
}
