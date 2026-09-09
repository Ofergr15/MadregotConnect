import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { fetchWeekTargets } from '@/lib/plans/week-target-history';
import { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';
import { getActivityWeekStart, israelDateAnchor } from '@/lib/utils';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// GET /api/athletes/volume-history?athleteId=…&weeks=12
// GET /api/athletes/volume-history?athleteId=…&granularity=month|year&periods=12
// Training-volume history for an athlete. Default `granularity=week` returns the
// most recent `weeks` weeks, each with `target` — that week's own plan band,
// recomputed from that week's `weekly_plans` row, so the chart can mark the weeks
// that landed on the plan they actually had rather than against today's band.
// `month`/`year` aggregate the underlying weekly rows into calendar buckets (a
// week is bucketed by its own week_start's month/year — the same approximation the
// rest of the app's week-bucketing already uses, not a precise pro-rata split
// across a month boundary). Scoped like /prs and /summary: own athlete, staff, or
// super-user.
//
// This used to read weekly_km_snapshots and called it the durable record. It is
// durable and it is also wrong: its `week_start` anchor changed mid-history and
// the old rows were never re-keyed, so the chart drew overlapping columns and rest
// weeks that never happened — one athlete's steady 175-185 km came out as
// `179.3 72.3 52.2 177.8 0 182.7 174.5 93.3`. Bucketed from the activities now;
// see lib/athletes/weekly-volume.ts. The cost is that editing or deleting an old
// run moves history, which the snapshot table was immune to — worth it to stop
// showing numbers nobody ran.
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

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // Enough weeks to fill `periods` buckets at the requested granularity
    // (~4.3 weeks/month, 52 weeks/year), plus a small buffer.
    const fetchWeeks = granularity === 'week' ? weeks : granularity === 'month' ? periods * 5 + 8 : periods * 53 + 8;
    const { byAthlete } = await fetchWeeklyVolume(supabase, {
      athleteIds: [athleteId],
      weeks: fetchWeeks,
      currentWeekStart: getActivityWeekStart(israelDateAnchor()),
    });

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const weekRows = (byAthlete.get(athleteId) || []).map((b) => ({
      weekStart: b.weekStart,
      km: round1(b.meters / 1000),
      runs: b.runs,
      durationSec: b.seconds,
    }));

    let series: Array<(typeof weekRows)[number] & { target?: { min: number; max: number } }> = weekRows;
    if (granularity === 'week') {
      // Each week's own target band, so the chart can show whether that week
      // landed on the plan THAT WEEK. Only at week granularity: a month has no
      // target of its own, and summing the bands of whichever weeks happen to
      // have a plan row would invent one.
      const targets = await fetchWeekTargets(supabase, COACH_ID, weekRows.map((w) => w.weekStart));
      series = weekRows.map((w) => {
        const t = targets.get(w.weekStart);
        return t ? { ...w, target: { min: t.min, max: t.max } } : w;
      });
    }
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
