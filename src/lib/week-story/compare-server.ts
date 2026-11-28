import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { addDays } from './model';
import { buildWeekCompare, type CompareRun, type GroupInfo, type WeekCompare } from './compare';

// The reads behind lib/week-story/compare.ts (task 184). Two activity reads, both paged
// (Supabase caps a select at 1000 rows and reports the truncation as success):
//   - the caller's runs over five activity weeks, for the trend;
//   - every active member's runs in the one week, for the group stats.
// Activity days are the row's own wall-clock date (start_time is UTC-shaped local time).

const cols = 'id, athlete_id, activity_type, start_time, distance, duration';

export async function loadWeekCompare(db: SupabaseClient, athleteId: string, weekStart: string): Promise<WeekCompare | null> {
  const { data: me } = await db.from('athletes').select('id').eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
  if (!me) return null;
  const weekEnd = addDays(weekStart, 6);
  const trendFrom = addDays(weekStart, -28);
  const next = addDays(weekEnd, 1);

  const [roster, groupsRes, mine] = await Promise.all([
    fetchAllRows<{ id: string; group_id: string | null }>((a, b) => db.from('athletes').select('id, group_id')
      .eq('coach_id', COACH_ID).eq('status', 'active').not('group_id', 'is', null).order('id').range(a, b)),
    db.from('groups').select('id, name'),
    fetchAllRows<RunActivityRow>((a, b) => db.from('athlete_activities').select(cols)
      .eq('athlete_id', athleteId).gte('start_time', `${trendFrom}T00:00:00`).lt('start_time', `${next}T00:00:00`)
      .order('start_time').order('id').range(a, b)),
  ]);
  const memberGroup = new Map(roster.filter((r) => r.group_id).map((r) => [r.id, r.group_id as string]));
  const ids = [...memberGroup.keys()];
  const club = ids.length
    ? await fetchAllRows<RunActivityRow & { athlete_id: string }>((a, b) => db.from('athlete_activities').select(cols)
      .in('athlete_id', ids).gte('start_time', `${weekStart}T00:00:00`).lt('start_time', `${next}T00:00:00`)
      .order('start_time').order('id').range(a, b))
    : [];

  const groups: GroupInfo[] = ((groupsRes.data || []) as Array<{ id: string; name: string | null }>)
    .map((g) => ({ id: g.id, name: g.name || g.id }));
  const toRun = (r: RunActivityRow & { athlete_id?: string }): CompareRun => ({
    athleteId: r.athlete_id ?? athleteId, day: r.start_time.slice(0, 10), km: r.distance / 1000,
  });
  return buildWeekCompare({
    weekStart,
    athleteId,
    myRuns: filterQualifyingRuns(mine).map(toRun),
    clubRuns: filterQualifyingRuns(club).map(toRun),
    memberGroup,
    groups,
  });
}
