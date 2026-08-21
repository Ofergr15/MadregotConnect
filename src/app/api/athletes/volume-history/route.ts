import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// GET /api/athletes/volume-history?athleteId=…&weeks=12
// GET /api/athletes/volume-history?athleteId=…&granularity=month|year&periods=12
// Durable training-volume history for an athlete, read from weekly_km_snapshots
// (written nightly by the sync cron — a complete per-week record incl. zero
// weeks, unaffected by later activity edits). Default `granularity=week`
// returns the most recent `weeks` weeks unchanged (existing callers). `month`/
// `year` aggregate the underlying weekly rows into calendar buckets (a week is
// bucketed by its own week_start's month/year — the same approximation the
// rest of the app's week-bucketing already uses, not a precise pro-rata split
// across a month boundary). Scoped like /prs and /summary: own athlete, staff,
// or super-user.
export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    const granularity = (searchParams.get('granularity') || 'week') as 'week' | 'month' | 'year';
    const weeks = Math.min(Math.max(Number(searchParams.get('weeks')) || 12, 1), 52);
    const periods = Math.min(
      Math.max(Number(searchParams.get('periods')) || (granularity === 'year' ? 6 : 12), 1),
      granularity === 'year' ? 10 : 36
    );

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

    // Enough raw weekly rows to fill `periods` buckets at the requested
    // granularity (~4.3 weeks/month, 52 weeks/year), plus a small buffer.
    const fetchLimit = granularity === 'week' ? weeks : granularity === 'month' ? periods * 5 + 8 : periods * 53 + 8;
    const { data, error } = await supabase
      .from('weekly_km_snapshots')
      .select('week_start, distance_m, runs, duration_s')
      .eq('athlete_id', athleteId)
      .order('week_start', { ascending: false })
      .limit(fetchLimit);
    if (error) throw error;

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const weekRows = (data || [])
      .slice()
      .reverse()
      .map((r: any) => ({
        weekStart: r.week_start as string,
        km: round1((Number(r.distance_m) || 0) / 1000),
        runs: Number(r.runs) || 0,
        durationSec: Number(r.duration_s) || 0,
      }));

    let series = weekRows;
    if (granularity !== 'week') {
      const bucketLen = granularity === 'year' ? 4 : 7; // 'YYYY' or 'YYYY-MM'
      const buckets = new Map<string, { weekStart: string; km: number; runs: number; durationSec: number }>();
      for (const w of weekRows) {
        const key = w.weekStart.slice(0, bucketLen);
        const b = buckets.get(key) || { weekStart: key, km: 0, runs: 0, durationSec: 0 };
        b.km = round1(b.km + w.km);
        b.runs += w.runs;
        b.durationSec += w.durationSec;
        buckets.set(key, b);
      }
      series = Array.from(buckets.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-periods);
    }

    // Simple summary: peak period, average of periods that had ≥1 run — cheap
    // context for the chart header.
    const ran = series.filter((s) => s.runs > 0);
    const peakKm = series.reduce((m, s) => (s.km > m ? s.km : m), 0);
    const avgKm = ran.length ? round1(ran.reduce((a, s) => a + s.km, 0) / ran.length) : 0;

    return NextResponse.json({ series, weeksReturned: series.length, peakKm, avgKm, granularity });
  } catch (err: any) {
    console.error('volume-history error:', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
