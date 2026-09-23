import type { SupabaseClient } from '@supabase/supabase-js';
import { GarminClient } from '@/lib/garmin/client';
import { israelToday } from '@/lib/utils';

/**
 * The nightly sleep + resting-HR pull (#69).
 *
 * The weekly summary had every number a watch records about a run and none of
 * what it records about the other 23 hours. Garmin has both; nothing fetched them.
 *
 * Each night looks back LOOKBACK_DAYS and asks only for the nights still missing,
 * so a phone that syncs a day late fills in on the next pass and a first run
 * backfills a week — without asking Garmin again for a night already stored.
 * A night Garmin had nothing for is stored with nulls and retried until it falls
 * out of the window: "not synced yet" and "not worn" look identical from here.
 */
export const LOOKBACK_DAYS = 7;

/** YYYY-MM-DD `n` days before `date`. */
export function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** The dates in the window with no value yet, newest first. */
export function missingNights(
  today: string,
  stored: { date: string; sleep_seconds: number | null; resting_hr: number | null }[],
): string[] {
  const done = new Set(stored.filter(r => r.sleep_seconds != null || r.resting_hr != null).map(r => r.date));
  const out: string[] = [];
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const d = daysBefore(today, i);
    if (!done.has(d)) out.push(d);
  }
  return out;
}

export async function sweepWellness(supabase: SupabaseClient, today = israelToday()) {
  const { data: athletes, error } = await supabase
    .from('athletes')
    .select('id, garmin_auth')
    .eq('status', 'active')
    .not('garmin_auth', 'is', null);
  if (error) throw error;

  const since = daysBefore(today, LOOKBACK_DAYS - 1);
  let fetched = 0;
  let stored = 0;
  const failed: string[] = [];

  for (const athlete of athletes || []) {
    try {
      const { data: have } = await supabase
        .from('athlete_wellness')
        .select('date, sleep_seconds, resting_hr')
        .eq('athlete_id', athlete.id)
        .gte('date', since);
      const nights = missingNights(today, have || []);
      if (nights.length === 0) continue;

      const client = new GarminClient(athlete.garmin_auth as any);
      const rows = [];
      for (const date of nights) {
        try {
          const w = await client.getWellness(date);
          fetched++;
          rows.push({
            athlete_id: athlete.id, date,
            sleep_seconds: w.sleepSeconds, resting_hr: w.restingHr,
            fetched_at: new Date().toISOString(),
          });
        } catch {
          // One night failing (Garmin 5xx, rate limit) must not cost the rest.
        }
      }
      if (rows.length) {
        const { error: upErr } = await supabase.from('athlete_wellness').upsert(rows, { onConflict: 'athlete_id,date' });
        if (upErr) throw upErr;
        stored += rows.filter(r => r.sleep_seconds != null || r.resting_hr != null).length;
      }
    } catch (e) {
      failed.push(`${athlete.id}: ${(e as Error).message}`);
    }
  }
  return { athletes: (athletes || []).length, fetched, stored, failed };
}
