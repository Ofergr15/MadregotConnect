import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { shiftDate } from './load';
import { RANGE_DAYS, type WellnessNight } from './normal-range';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/**
 * The nights screen 8 stands on: the window the ranges need (30 before the newest morning)
 * plus that morning. Shared by GET /api/academy/body and the admin data-coverage check, so
 * the check judges the same nights the screen draws. Before migration 123's `fetched_at`
 * it reads without it; any read error is "no nights" (the screen's learning state).
 */
export async function readBodyNights(supabase: Db, athleteId: string, today: string): Promise<WellnessNight[]> {
  const from = shiftDate(today, -(RANGE_DAYS * 2));
  const read = (cols: string) => supabase
    .from('athlete_wellness')
    .select(cols)
    .eq('athlete_id', athleteId)
    .gte('date', from)
    .lte('date', today);
  let res = await read('date, sleep_seconds, resting_hr, fetched_at');
  if (res.error && isMissingColumn(res.error)) res = await read('date, sleep_seconds, resting_hr');
  return ((res.error ? [] : res.data) || []).map((n: any) => ({
    date: String(n.date).slice(0, 10),
    sleep_seconds: n.sleep_seconds ?? null,
    resting_hr: n.resting_hr ?? null,
    fetched_at: n.fetched_at ?? null,
  }));
}
