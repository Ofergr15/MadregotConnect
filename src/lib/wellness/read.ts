import type { SupabaseClient } from '@supabase/supabase-js';
import type { WellnessNight } from '@/lib/reports/last-7-days';
import { daysBefore } from './sweep';
import { israelToday } from '@/lib/utils';

/**
 * An athlete's recorded nights, oldest first. Health data: callers pass the
 * athlete off the SESSION and only for the athlete themselves.
 * Empty before migration 123 or on any read error — the week just has no sleep row.
 */
export async function readWellnessNights(supabase: SupabaseClient, athleteId: string, days = 8): Promise<WellnessNight[]> {
  const { data, error } = await supabase
    .from('athlete_wellness')
    .select('date, sleep_seconds, resting_hr')
    .eq('athlete_id', athleteId)
    .gte('date', daysBefore(israelToday(), days - 1))
    .order('date', { ascending: true });
  return error ? [] : ((data || []) as WellnessNight[]);
}
