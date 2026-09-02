import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getActivityWeekStart, activityWeekStart, computeWeekStreak, israelDateAnchor } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/athletes/summary?athleteId=…
// Momentum + all-time stats for the athlete, derived from run history (no new
// capture):
//  - weekStreak: consecutive activity-weeks (Sunday-based) with ≥1 run,
//    counting back from the current or previous week.
//  - thisWeek / lastWeek: km + runs, for a "this week vs last" recap.
//  - biggestWeek: the athlete's peak weekly volume ever (Sunday-based), so the
//    dashboard can celebrate "your biggest week: 62 ק״מ".
//  - longestStreak: the longest run of consecutive active weeks ever (not just
//    the current one) — for the Statistics screen's consistency card.
//  - activeWeeksRatio: how many of the last (up to) 52 weeks had ≥1 run,
//    denominator capped to weeks-since-first-activity so a newer athlete isn't
//    penalized for weeks before they joined.
// Scoped auth identical to /prs: own athlete, staff, or super-user.
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'];

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { data: acts, error } = await supabase
      .from('athlete_activities')
      .select('activity_type, start_time, distance, duration')
      .eq('athlete_id', athleteId)
      .order('start_time', { ascending: false });
    if (error) throw error;

    const runs = (acts || []).filter(
      (a: any) => a.distance > 0 && (!a.activity_type || RUN_TYPES.includes(a.activity_type))
    );

    // All-time total km/hours + this-calendar-month run count (dashboard/stats).
    const now = new Date();
    // Israel's calendar day, NOT the server's UTC one: between 00:00 and 03:00
    // Israel a raw `new Date()` still reads as yesterday, so "this week" and
    // "this month" would both be a period behind — and on a Sunday or the 1st
    // of a month, off by a whole week/month.
    const today = israelDateAnchor(now);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    let totalKm = 0;
    let totalDurationSec = 0;
    let thisMonthRuns = 0;
    for (const r of runs) {
      totalKm += r.distance / 1000;
      totalDurationSec += r.duration || 0;
      if (new Date(r.start_time).getTime() >= monthStart) thisMonthRuns += 1;
    }

    // Bucket runs by activity-week (Sunday-based ISO date).
    const byWeek = new Map<string, { km: number; runs: number }>();
    for (const r of runs) {
      const wk = activityWeekStart(r.start_time);
      const b = byWeek.get(wk) || { km: 0, runs: 0 };
      b.km += r.distance / 1000;
      b.runs += 1;
      byWeek.set(wk, b);
    }

    const thisWeekKey = getActivityWeekStart(today);
    const lastWeekKey = getActivityWeekStart(new Date(today.getTime() - 7 * 86400_000));
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

    // Week streak: consecutive activity-weeks with ≥1 run — see computeWeekStreak
    // in lib/utils (shared with the streak leaderboard so the math stays in sync).
    const streak = computeWeekStreak(new Set(byWeek.keys()), now);

    // Longest streak ever: walk all active weeks in chronological order,
    // extending a run while consecutive weeks are exactly 7 days apart.
    const sortedWeekTimes = Array.from(byWeek.keys())
      .map((wk) => new Date(`${wk}T12:00:00Z`).getTime())
      .sort((a, b) => a - b);
    let longestStreak = 0;
    let run = 0;
    for (let i = 0; i < sortedWeekTimes.length; i++) {
      if (i > 0 && sortedWeekTimes[i] - sortedWeekTimes[i - 1] === 7 * 86400_000) run += 1;
      else run = 1;
      if (run > longestStreak) longestStreak = run;
    }

    // Active-weeks ratio over the trailing 52 weeks, denominator capped to
    // weeks-since-first-activity so a newer athlete isn't penalized for weeks
    // before they joined.
    let activeWeeksRatio: { active: number; total: number } | null = null;
    if (sortedWeekTimes.length > 0) {
      const weeksSinceFirst = Math.min(52, Math.floor((now.getTime() - sortedWeekTimes[0]) / (7 * 86400_000)) + 1);
      let active = 0;
      const cursor = new Date(getActivityWeekStart(today));
      for (let i = 0; i < weeksSinceFirst; i++) {
        const key = cursor.toISOString().split('T')[0];
        if (byWeek.has(key)) active += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 7);
      }
      activeWeeksRatio = { active, total: weeksSinceFirst };
    }

    return NextResponse.json({
      weekStreak: streak,
      longestStreak,
      activeWeeksRatio,
      thisWeek,
      lastWeek,
      biggestWeek,
      totalRuns: runs.length,
      totalKm: Math.round(totalKm),
      totalHours: Math.round((totalDurationSec / 3600) * 10) / 10,
      thisMonthRuns,
    });
  } catch (err: any) {
    console.error('summary error:', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
