import type { createServerClient } from '@/lib/supabase/server';
import { activityLocalDateStr } from '@/lib/utils';

type SupabaseServer = ReturnType<typeof createServerClient>;

export interface RaceMatchRow {
  id: string;
  activity_id: string;
  athlete_id: string;
  event_id: string | null;
  is_race: boolean;
  match_method: 'auto' | 'manual';
  evidence: Record<string, unknown>;
  overridden_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Recomputes automatic race matches for one athlete (roadmap #20): any
 * activity that falls on the same calendar day as an `events` row with
 * kind='race' is treated as a completed race. Mirrors the auto/manual split
 * in `match-athlete-activities.ts` — every existing MANUAL row (a tag OR a
 * correction, incl. an `is_race: false` "not actually a race" override) is
 * left untouched and blocks that activity from being re-matched here.
 *
 * Cheap to call on every read: both tables are small per-athlete, and this
 * wholesale delete-then-reinsert of the 'auto' rows means an event's date
 * being edited later (or a race being un-scheduled) never leaves a stale
 * match behind.
 */
export async function recomputeRaceMatches(
  supabase: SupabaseServer,
  athleteId: string,
): Promise<{ matched: number }> {
  const [
    { data: activities, error: activityError },
    { data: raceEvents, error: eventError },
    { data: manualMatches, error: manualError },
  ] = await Promise.all([
    supabase
      .from('athlete_activities')
      .select('id, start_time')
      .eq('athlete_id', athleteId)
      .order('start_time', { ascending: true }),
    supabase.from('events').select('id, name, date').eq('kind', 'race'),
    supabase
      .from('race_matches')
      .select('activity_id')
      .eq('athlete_id', athleteId)
      .eq('match_method', 'manual'),
  ]);
  if (activityError) throw activityError;
  if (eventError) throw eventError;
  if (manualError) throw manualError;

  const eventsByDate = new Map((raceEvents || []).map((event) => [event.date, event]));
  const manualActivityIds = new Set((manualMatches || []).map((match) => match.activity_id));

  const { error: deleteError } = await supabase
    .from('race_matches')
    .delete()
    .eq('athlete_id', athleteId)
    .eq('match_method', 'auto');
  if (deleteError) throw deleteError;

  const rows = (activities || [])
    .filter((activity) => !manualActivityIds.has(activity.id))
    .map((activity) => {
      const day = activityLocalDateStr(activity.start_time);
      const event = eventsByDate.get(day);
      if (!event) return null;
      return {
        activity_id: activity.id,
        athlete_id: athleteId,
        event_id: event.id,
        is_race: true,
        match_method: 'auto' as const,
        evidence: { matchedBy: 'same_day', eventName: event.name, eventDate: event.date },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from('race_matches').insert(rows);
    if (insertError) throw insertError;
  }

  return { matched: rows.length };
}
