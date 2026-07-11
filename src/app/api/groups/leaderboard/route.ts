import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { getActivityWeekStart } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServerClient();
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
      return NextResponse.json({ leaderboard: [], groupLeaderboards: {} });
    }

    const { data: activities, error: actError } = await supabase
      .from('athlete_activities')
      .select('athlete_id, distance, duration, start_time')
      .in('athlete_id', athleteIds)
      .gte('start_time', weekStart);

    if (actError) throw actError;

    const athleteStats = new Map<string, { distance: number; runs: number; duration: number }>();
    for (const act of (activities || [])) {
      const existing = athleteStats.get(act.athlete_id) || { distance: 0, runs: 0, duration: 0 };
      existing.distance += act.distance || 0;
      existing.runs += 1;
      existing.duration += act.duration || 0;
      athleteStats.set(act.athlete_id, existing);
    }

    const leaderboard = (athletes || []).map(a => {
      const stats = athleteStats.get(a.id) || { distance: 0, runs: 0, duration: 0 };
      return {
        id: a.id,
        name: a.name,
        groupId: a.group_id,
        distanceKm: Math.round(stats.distance / 100) / 10,
        runs: stats.runs,
        durationMin: Math.round(stats.duration / 60),
      };
    })
      .filter(a => a.distanceKm > 0)
      .sort((a, b) => b.distanceKm - a.distanceKm);

    const groupLeaderboards: Record<string, typeof leaderboard> = {};
    for (const entry of leaderboard) {
      if (entry.groupId) {
        if (!groupLeaderboards[entry.groupId]) {
          groupLeaderboards[entry.groupId] = [];
        }
        groupLeaderboards[entry.groupId].push(entry);
      }
    }

    return NextResponse.json({ leaderboard, groupLeaderboards, weekStart });
  } catch (error: any) {
    console.error('Leaderboard error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
