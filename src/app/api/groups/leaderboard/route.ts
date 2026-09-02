import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { requireMember } from '@/lib/auth/self-or-staff';
import { rethrowIfDynamicBailout } from '@/lib/dynamic-bailout';
import { getActivityWeekStart, activityWeekStart, computeWeekStreak, israelDateAnchor } from '@/lib/utils';

// Weekly totals — a short staleness window is invisible to users, so this
// route participates in Next's Data Cache instead of forcing dynamic
// rendering on every request. See src/lib/supabase/server.ts for how
// `revalidateSeconds` maps to the underlying fetch's cache behavior.
//
// Reading the caller's session below means the ROUTE is no longer statically
// prerendered (it was ○ in the build output, now ƒ). The expensive part is
// unaffected: `revalidateSeconds: 60` caches the three Supabase queries in the
// Data Cache, so a burst of athletes opening the leaderboard still costs one
// round of DB work per minute — only the ranking arithmetic is per-request.
export const revalidate = 60;

// Qualifying "run" activity types for the streak metric — matches
// /api/athletes/summary's weekStreak so the leaderboard and the personal
// momentum card never disagree about what counts as a run.
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'];

interface LeaderboardEntry {
  id: string;
  name: string;
  groupId: string | null;
  gender: 'male' | 'female' | null;
  distanceKm: number;
  runs: number;
  durationMin: number;
  weekStreak: number;
  monthlyKm: number;
  monthlyRuns: number;
  eventCount: number;
}

/** First day of `now`'s calendar month as YYYY-MM-DD. Callers pass an
 * Israel-anchored date, so this is the Israel month. Built by string, not via
 * toISOString() on a local-midnight Date — that re-expresses midnight in UTC
 * and lands on the last day of the PREVIOUS month in any positive-offset zone. */
function monthStartIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function GET(request: Request) {
  try {
    // Club-internal: every member legitimately sees the leaderboard, but it's
    // the whole active roster by name with each person's weekly distance, run
    // count, streak and monthly volume — a training log for ~20 named people,
    // which was readable by anyone who knew the URL.
    const denied = await requireMember(request);
    if (denied) return denied;

    const supabase = createServerClient({ revalidateSeconds: 60 });
    // Israel's calendar day, not the server's UTC one — see israelDateAnchor.
    const now = israelDateAnchor();
    // Sunday-based week (club standard since 2026-08-21), matching weekly_plans.
    const weekStart = getActivityWeekStart(now);

    const { data: athletes, error: athError } = await supabase
      .from('athletes')
      .select('id, name, group_id, gender, status')
      .eq('coach_id', COACH_ID)
      .eq('status', 'active');

    if (athError) throw athError;

    const athleteIds = (athletes || []).map(a => a.id);

    if (athleteIds.length === 0) {
      return NextResponse.json({
        leaderboard: [], leaderboardByStreak: [], leaderboardByRuns: [], leaderboardMonthly: [], leaderboardByEvents: [],
        groupLeaderboards: {}, weekStart, monthStart: monthStartIso(now),
      });
    }

    const monthStart = monthStartIso(now);

    // Three independent queries: this week's totals (distance/runs/duration),
    // each athlete's full run history (streak + monthly totals both derive
    // from this one fetch), and all-time event registrations.
    const [weeklyRes, historyRes, eventRegRes] = await Promise.all([
      supabase
        .from('athlete_activities')
        .select('athlete_id, distance, duration, start_time')
        .in('athlete_id', athleteIds)
        .gte('start_time', weekStart),
      supabase
        .from('athlete_activities')
        .select('athlete_id, activity_type, distance, start_time')
        .in('athlete_id', athleteIds),
      supabase
        .from('event_registrations')
        .select('athlete_id')
        .in('athlete_id', athleteIds)
        .neq('status', 'cancelled'),
    ]);

    if (weeklyRes.error) throw weeklyRes.error;
    if (historyRes.error) throw historyRes.error;
    // event_registrations (migration 055) may not be applied yet — event
    // participation just degrades to 0 for everyone rather than failing the
    // whole leaderboard.
    const eventRegs = eventRegRes.error ? [] : (eventRegRes.data || []);

    const athleteStats = new Map<string, { distance: number; runs: number; duration: number }>();
    for (const act of (weeklyRes.data || [])) {
      const existing = athleteStats.get(act.athlete_id) || { distance: 0, runs: 0, duration: 0 };
      existing.distance += act.distance || 0;
      existing.runs += 1;
      existing.duration += act.duration || 0;
      athleteStats.set(act.athlete_id, existing);
    }

    const eventCountByAthlete = new Map<string, number>();
    for (const reg of eventRegs as Array<{ athlete_id: string }>) {
      eventCountByAthlete.set(reg.athlete_id, (eventCountByAthlete.get(reg.athlete_id) || 0) + 1);
    }

    // Bucket each athlete's qualifying runs (RUN_TYPES, distance>0) by
    // activity-week, mirroring /api/athletes/summary's byWeek map — then hand
    // each athlete's set of week-keys to the shared computeWeekStreak helper.
    // The same pass also accumulates this calendar month's distance/run count
    // (monthStart is a plain server-clock boundary, same approximation the
    // week bucketing already uses — not timezone-precise).
    const weeksByAthlete = new Map<string, Set<string>>();
    const monthlyByAthlete = new Map<string, { distance: number; runs: number }>();
    for (const act of (historyRes.data || []) as any[]) {
      if (!(act.distance > 0) || (act.activity_type && !RUN_TYPES.includes(act.activity_type))) continue;
      const weeks = weeksByAthlete.get(act.athlete_id) || new Set<string>();
      weeks.add(activityWeekStart(act.start_time));
      weeksByAthlete.set(act.athlete_id, weeks);

      if (act.start_time.slice(0, 10) >= monthStart) {
        const m = monthlyByAthlete.get(act.athlete_id) || { distance: 0, runs: 0 };
        m.distance += act.distance || 0;
        m.runs += 1;
        monthlyByAthlete.set(act.athlete_id, m);
      }
    }

    const entries: LeaderboardEntry[] = (athletes || []).map(a => {
      const stats = athleteStats.get(a.id) || { distance: 0, runs: 0, duration: 0 };
      const weeks = weeksByAthlete.get(a.id);
      const monthly = monthlyByAthlete.get(a.id) || { distance: 0, runs: 0 };
      return {
        id: a.id,
        monthlyKm: Math.round(monthly.distance / 100) / 10,
        monthlyRuns: monthly.runs,
        eventCount: eventCountByAthlete.get(a.id) || 0,
        name: a.name,
        groupId: a.group_id,
        gender: a.gender,
        distanceKm: Math.round(stats.distance / 100) / 10,
        runs: stats.runs,
        durationMin: Math.round(stats.duration / 60),
        weekStreak: weeks ? computeWeekStreak(weeks, now) : 0,
      };
    });

    // Three ranked views of the same entries, one per metric, so the UI can
    // switch tabs instantly without a refetch.
    const leaderboard = entries
      .filter(a => a.distanceKm > 0)
      .sort((a, b) => b.distanceKm - a.distanceKm);
    const leaderboardByStreak = entries
      .filter(a => a.weekStreak > 0)
      .sort((a, b) => b.weekStreak - a.weekStreak || b.distanceKm - a.distanceKm);
    const leaderboardByRuns = entries
      .filter(a => a.runs > 0)
      .sort((a, b) => b.runs - a.runs || b.distanceKm - a.distanceKm);
    const leaderboardMonthly = entries
      .filter(a => a.monthlyKm > 0)
      .sort((a, b) => b.monthlyKm - a.monthlyKm);
    const leaderboardByEvents = entries
      .filter(a => a.eventCount > 0)
      .sort((a, b) => b.eventCount - a.eventCount || b.distanceKm - a.distanceKm);

    // Group breakdown stays distance-based (squad-total km card on the Groups
    // page) — the metric tabs only apply to the flat "Overall" ranking.
    const groupLeaderboards: Record<string, LeaderboardEntry[]> = {};
    for (const entry of leaderboard) {
      if (entry.groupId) {
        if (!groupLeaderboards[entry.groupId]) {
          groupLeaderboards[entry.groupId] = [];
        }
        groupLeaderboards[entry.groupId].push(entry);
      }
    }

    return NextResponse.json({
      leaderboard, leaderboardByStreak, leaderboardByRuns, leaderboardMonthly, leaderboardByEvents,
      groupLeaderboards, weekStart, monthStart,
    });
  } catch (error: any) {
    rethrowIfDynamicBailout(error);
    console.error('Leaderboard error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
