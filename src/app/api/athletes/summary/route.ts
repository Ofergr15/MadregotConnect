import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';
import { getActivityWeekStart } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/athletes/summary?athleteId=…
// Momentum stats for the athlete, derived from run history (no new capture):
//  - weekStreak: consecutive activity-weeks (Mon-based) with ≥1 run, counting
//    back from the current or previous week.
//  - thisWeek / lastWeek: km + runs, for a "this week vs last" recap.
//  - biggestWeek: the athlete's peak weekly volume ever (Mon-based), so the
//    dashboard can celebrate "your biggest week: 62 ק״מ".
// Scoped auth identical to /prs: own athlete, staff, or super-user.
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'];

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });

    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    let allowed = false;
    if (isSuperUser(email)) {
      allowed = true;
    } else if (email) {
      const { data: caller } = await supabase
        .from('athletes').select('id, role').eq('email', email).maybeSingle();
      const isStaff = !!caller && ['coach', 'admin', 'academy_coach'].includes((caller as any).role);
      allowed = isStaff || (caller as any)?.id === athleteId;
    }
    if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { data: acts, error } = await supabase
      .from('athlete_activities')
      .select('activity_type, start_time, distance, duration')
      .eq('athlete_id', athleteId)
      .order('start_time', { ascending: false });
    if (error) throw error;

    const runs = (acts || []).filter(
      (a: any) => a.distance > 0 && (!a.activity_type || RUN_TYPES.includes(a.activity_type))
    );

    // Bucket runs by activity-week (Mon-based ISO date).
    const byWeek = new Map<string, { km: number; runs: number }>();
    for (const r of runs) {
      const wk = getActivityWeekStart(new Date(r.start_time));
      const b = byWeek.get(wk) || { km: 0, runs: 0 };
      b.km += r.distance / 1000;
      b.runs += 1;
      byWeek.set(wk, b);
    }

    const thisWeekKey = getActivityWeekStart(new Date());
    const lastWeekKey = getActivityWeekStart(new Date(Date.now() - 7 * 86400_000));
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const thisWeek = { km: round1(byWeek.get(thisWeekKey)?.km || 0), runs: byWeek.get(thisWeekKey)?.runs || 0 };
    const lastWeek = { km: round1(byWeek.get(lastWeekKey)?.km || 0), runs: byWeek.get(lastWeekKey)?.runs || 0 };

    // Biggest week ever: the highest weekly volume across all activity-weeks.
    // Null when there's no run history so the card can hide.
    let biggestWeek: { weekStart: string; km: number; runs: number } | null = null;
    for (const [wk, b] of byWeek) {
      if (!biggestWeek || b.km > biggestWeek.km) {
        biggestWeek = { weekStart: wk, km: round1(b.km), runs: b.runs };
      }
    }

    // Week streak: count consecutive prior weeks (stepping back 7 days) that have
    // ≥1 run. Start from the current week if it has a run, else from last week
    // (so the streak doesn't read 0 early in a new week before you've run yet).
    let streak = 0;
    let cursor = new Date();
    if (!byWeek.has(thisWeekKey)) cursor = new Date(Date.now() - 7 * 86400_000);
    for (let i = 0; i < 260; i++) { // cap ~5 years
      const key = getActivityWeekStart(cursor);
      if (byWeek.has(key)) { streak++; cursor = new Date(cursor.getTime() - 7 * 86400_000); }
      else break;
    }

    return NextResponse.json({ weekStreak: streak, thisWeek, lastWeek, biggestWeek, totalRuns: runs.length });
  } catch (err: any) {
    console.error('summary error:', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
