import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Club stats are counted from this date forward (the current season).
const SINCE = '2026-06-01';

// ── Why this is cached ───────────────────────────────────────────────────────
// Measured at 1969 ms, and it is the landing page's only data request — so that
// was two seconds of empty stat cards for every first-time visitor, i.e. the
// club's first impression. The cost is structural: there is no SUM in
// supabase-js, so the route pages through EVERY activity row of the season
// (1000 at a time) and adds them up in JS. A season's worth of rows is not
// getting shorter.
//
// It is also the easiest thing in the app to cache, because none of it is about
// the viewer: four aggregates and a public top-3, on a route that is
// unauthenticated by design. Nobody is watching these numbers for a change, and
// a workout finished five minutes ago showing up five minutes later is not a
// thing anyone can perceive.
//
// Two layers, because they cover different misses. `s-maxage` is the one that
// matters in production — Vercel's CDN answers from the edge and the function
// isn't invoked at all; `stale-while-revalidate` means even the request that
// refreshes it is served instantly from the old copy. The in-process memo below
// covers what the CDN can't: several instances warming at once, and local `next
// start` where there is no CDN.
//
// A real fix for the underlying scan is a Postgres aggregate behind an RPC. That
// needs a migration (applied by hand — see CLAUDE.md), and with this in front of
// it the route now runs a handful of times an hour, so it isn't urgent.
const CDN_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';
const MEMO_TTL_MS = 300_000;
let memo: { body: Stats; expires: number } | null = null;

interface Stats {
  since: string;
  athletes: number;
  totalKm: number;
  workouts: number;
  totalHours: number;
  topResults: { name: string; timeSeconds: number; test: string }[];
  testDate: string | null;
}

/**
 * GET /api/public/stats — PUBLIC, unauthenticated. Aggregate social-proof numbers
 * for the landing page only. No private/individual data beyond top-3 name+time
 * (already public on the Races board). Guarded so an unmigrated DB yields zeros.
 */
export async function GET() {
  if (memo && memo.expires > Date.now()) {
    return NextResponse.json(memo.body, { headers: { 'Cache-Control': CDN_CACHE } });
  }
  const out: Stats = {
    since: SINCE,
    athletes: 0,      // distinct runners with synced activity since SINCE
    totalKm: 0,
    workouts: 0,
    totalHours: 0,
    topResults: [],
    testDate: null,   // recorded_on of the shown test
  };

  let ok = false;
  try {
    const supabase = createServerClient();

    // The two halves have nothing to do with each other, so they wait together
    // rather than one after the other — the totals leg alone is several round
    // trips (one page of activities per 1000 rows).
    const [totals, bench] = await Promise.all([
      (async () => {
        // Totals across activities SINCE the season start for the coach's athletes.
        const { data: ath } = await supabase
          .from('athletes').select('id').eq('coach_id', COACH_ID);
        const ids = (ath || []).map((a: any) => a.id);
        if (!ids.length) return null;
        const rows: any[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data: page } = await supabase
            .from('athlete_activities')
            .select('distance, duration, athlete_id')
            .in('athlete_id', ids)
            .gte('start_time', `${SINCE}T00:00:00Z`)
            .range(offset, offset + 999);
          if (!page || page.length === 0) break;
          rows.push(...page);
          if (page.length < 1000) break;
        }
        return rows;
      })(),
      // Top-3 approved 2000m (or the first available test), with the test date.
      supabase
        .from('benchmark_results')
        .select('athlete_name, time_seconds, test_name, status, recorded_on')
        .eq('coach_id', COACH_ID)
        .order('time_seconds', { ascending: true })
        .then(({ data }) => data),
    ]);

    if (totals) {
      out.workouts = totals.length;
      out.totalKm = Math.round(totals.reduce((s, r) => s + (Number(r.distance) || 0), 0) / 1000);
      out.totalHours = Math.round(totals.reduce((s, r) => s + (Number(r.duration) || 0), 0) / 3600);
      out.athletes = new Set(totals.map(r => r.athlete_id)).size;
    }

    if (bench && bench.length) {
      const approved = bench.filter((b: any) => (b.status ?? 'approved') === 'approved');
      const test = approved.find((b: any) => b.test_name === '2000m')?.test_name || approved[0]?.test_name;
      const forTest = approved.filter((b: any) => b.test_name === test);
      out.topResults = forTest.slice(0, 3).map((b: any) => ({ name: b.athlete_name, timeSeconds: Number(b.time_seconds), test: b.test_name }));
      out.testDate = forTest.find((b: any) => b.recorded_on)?.recorded_on || null;
    }
    ok = true;
  } catch (e) {
    console.error('public stats error:', e);
  }

  // Only a read that actually completed. The catch above leaves `out` as the
  // all-zeros object, and memoising THAT would keep the landing page showing a
  // club with no runners for five minutes after one blip.
  if (ok) memo = { body: out, expires: Date.now() + MEMO_TTL_MS };
  return NextResponse.json(out, {
    headers: { 'Cache-Control': ok ? CDN_CACHE : 'no-store' },
  });
}
