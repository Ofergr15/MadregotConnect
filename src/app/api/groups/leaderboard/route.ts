import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { getActivityWeekStart, computeWeekStreak } from '@/lib/utils';

// Weekly totals — a short staleness window is invisible to users, so this
// route participates in Next's Data Cache instead of forcing dynamic
// rendering on every request. See src/lib/supabase/server.ts for how
// `revalidateSeconds` maps to the underlying fetch's cache behavior.
export const revalidate = 60;

// Qualifying "run" activity types for the streak metric — matches
// /api/athletes/summary's weekStreak so the leaderboard and the personal
// momentum card never disagree about what counts as a run.
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'];

interface LeaderboardEntry {
  id: string;
  name: string;
  groupId: string | null;
  distanceKm: number;
  runs: number;
  durationMin: number;
  weekStreak: number;
}

export async function GET() {
  try {
    const supabase = createServerClient({ revalidateSeconds: 60 });
    const now = new Date();
    // Monday-based week so weekly km matches Garmin/Strava reporting.
    const weekStart = getActivityWeekStart(now);

    const { data: athletes, error: athError } = await supabase
      .from('athletes')
      .select('id, name, group_id, status')
      .eq('coach_id', COACH_ID)
      .eq('status', 'active');

    if (athError) throw athError;

    const athleteIds = (athletes || []).map(a => a.id);

    if (athleteIds.length === 0) {
      return NextResponse.json({
        leaderboard: [], leaderboardByStreak: [], leaderboardByRuns: [], groupLeaderboards: {}, weekStart,
      });
    }

    // Two independent queries: this week's totals (distance/runs/duration —
    // unchanged from before) and each athlete's full run history, needed to
    // work out how many consecutive activity-weeks they've kept a streak.
    const [weeklyRes, historyRes] = await Promise.all([
      supabase
        .from('athlete_activities')
        .select('athlete_id, distance, duration, start_time')
        .in('athlete_id', athleteIds)
        .gte('start_time', weekStart),
      supabase
        .from('athlete_activities')
        .select('athlete_id, activity_type, distance, start_time')
        .in('athlete_id', athleteIds),
    ]);

    if (weeklyRes.error) throw weeklyRes.error;
    if (historyRes.error) throw historyRes.error;

    const athleteStats = new Map<string, { distance: number; runs: number; duration: number }>();
    for (const act of (weeklyRes.data || [])) {
      const existing = athleteStats.get(act.athlete_id) || { distance: 0, runs: 0, duration: 0 };
      existing.distance += act.distance || 0;
      existing.runs += 1;
      existing.duration += act.duration || 0;
      athleteStats.set(act.athlete_id, existing);
    }

    // Bucket each athlete's qualifying runs (RUN_TYPES, distance>0) by
    // activity-week, mirroring /api/athletes/summary's byWeek map — then hand
    // each athlete's set of week-keys to the shared computeWeekStreak helper.
    const weeksByAthlete = new Map<string, Set<string>>();
    for (const act of (historyRes.data || []) as any[]) {
      if (!(act.distance > 0) || (act.activity_type && !RUN_TYPES.includes(act.activity_type))) continue;
      const weeks = weeksByAthlete.get(act.athlete_id) || new Set<string>();
      weeks.add(getActivityWeekStart(new Date(act.start_time)));
      weeksByAthlete.set(act.athlete_id, weeks);
    }

    const entries: LeaderboardEntry[] = (athletes || []).map(a => {
      const stats = athleteStats.get(a.id) || { distance: 0, runs: 0, duration: 0 };
      const weeks = weeksByAthlete.get(a.id);
      return {
        id: a.id,
        name: a.name,
        groupId: a.group_id,
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

    return NextResponse.json({ leaderboard, leaderboardByStreak, leaderboardByRuns, groupLeaderboards, weekStart });
  } catch (error: any) {
    console.error('Leaderboard error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
