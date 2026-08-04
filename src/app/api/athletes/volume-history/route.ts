import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// GET /api/athletes/volume-history?athleteId=…&weeks=12
// Durable weekly training-volume history for an athlete, read from
// weekly_km_snapshots (written nightly by the sync cron — a complete per-week
// record incl. zero weeks, unaffected by later activity edits). Returns the most
// recent `weeks` weeks oldest→newest for a left-to-right trend chart.
// Scoped like /prs and /summary: own athlete, staff, or super-user.
export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    const weeks = Math.min(Math.max(Number(searchParams.get('weeks')) || 12, 1), 52);

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

    // Newest `weeks` rows for this athlete, then reverse to chronological order.
    const { data, error } = await supabase
      .from('weekly_km_snapshots')
      .select('week_start, distance_m, runs, duration_s')
      .eq('athlete_id', athleteId)
      .order('week_start', { ascending: false })
      .limit(weeks);
    if (error) throw error;

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const series = (data || [])
      .slice()
      .reverse()
      .map((r: any) => ({
        weekStart: r.week_start,
        km: round1((Number(r.distance_m) || 0) / 1000),
        runs: Number(r.runs) || 0,
        durationSec: Number(r.duration_s) || 0,
      }));

    // Simple summary: peak week, average of weeks that had ≥1 run, and the
    // trend (this week vs the prior one) — cheap context for the chart header.
    const ran = series.filter((s) => s.runs > 0);
    const peakKm = series.reduce((m, s) => (s.km > m ? s.km : m), 0);
    const avgKm = ran.length ? round1(ran.reduce((a, s) => a + s.km, 0) / ran.length) : 0;

    return NextResponse.json({ series, weeksReturned: series.length, peakKm, avgKm });
  } catch (err: any) {
    console.error('volume-history error:', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
