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

/**
 * The academy's normal ranges (lib/academy/normal-range.ts) need 14 of the last 30 nights,
 * and a week of lookback never gets there for someone who joined with history on the
 * watch. So a trainee short of that gets ONE deep pass of BACKFILL_LOOKBACK_DAYS — a few a
 * night, so the cron stays well inside its 300 s (about 30 Garmin calls each).
 */
export const BACKFILL_LOOKBACK_DAYS = 30;
export const BACKFILL_MIN_NIGHTS = 14;
export const WELLNESS_BACKFILL_PER_RUN = 5;

/** YYYY-MM-DD `n` days before `date`. */
export function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

type StoredNight = { date: string; sleep_seconds: number | null; resting_hr: number | null };

/** The dates in the window with no value yet, newest first. */
export function missingNights(
  today: string,
  stored: StoredNight[],
  lookback: number = LOOKBACK_DAYS,
): string[] {
  const done = new Set(stored.filter(r => r.sleep_seconds != null || r.resting_hr != null).map(r => r.date));
  const out: string[] = [];
  for (let i = 0; i < lookback; i++) {
    const d = daysBefore(today, i);
    if (!done.has(d)) out.push(d);
  }
  return out;
}

/** Nights with a value inside the last `days` (today included). */
export function storedNightCount(today: string, stored: StoredNight[], days: number = BACKFILL_LOOKBACK_DAYS): number {
  const since = daysBefore(today, days - 1);
  return stored.filter(r => r.date >= since && r.date <= today && (r.sleep_seconds != null || r.resting_hr != null)).length;
}

/**
 * How far back to look for this athlete tonight: the deep pass for an academy trainee whose
 * range is still being learned while this run has room for one more, else the week.
 */
export function lookbackFor(input: { isAcademy: boolean; storedIn30: number; backfillsSoFar: number }): number {
  return input.isAcademy && input.storedIn30 < BACKFILL_MIN_NIGHTS && input.backfillsSoFar < WELLNESS_BACKFILL_PER_RUN
    ? BACKFILL_LOOKBACK_DAYS
    : LOOKBACK_DAYS;
}

export async function sweepWellness(supabase: SupabaseClient, today = israelToday()) {
  let { data: athletes, error }: { data: Array<{ id: string; garmin_auth: unknown; is_academy?: boolean | null }> | null; error: any } = await supabase
    .from('athletes')
    .select('id, garmin_auth, is_academy')
    .eq('status', 'active')
    .not('garmin_auth', 'is', null);
  // Before the academy columns exist, everybody is on the week.
  if (error && /is_academy/.test(error.message || '')) {
    ({ data: athletes, error } = await supabase
      .from('athletes')
      .select('id, garmin_auth')
      .eq('status', 'active')
      .not('garmin_auth', 'is', null));
  }
  if (error) throw error;

  const since = daysBefore(today, BACKFILL_LOOKBACK_DAYS - 1);
  let fetched = 0;
  let stored = 0;
  let backfilled = 0;
  const failed: string[] = [];

  for (const athlete of (athletes || []) as Array<{ id: string; garmin_auth: unknown; is_academy?: boolean | null }>) {
    try {
      const { data: have } = await supabase
        .from('athlete_wellness')
        .select('date, sleep_seconds, resting_hr')
        .eq('athlete_id', athlete.id)
        .gte('date', since);
      const lookback = lookbackFor({
        isAcademy: !!athlete.is_academy,
        storedIn30: storedNightCount(today, have || []),
        backfillsSoFar: backfilled,
      });
      const nights = missingNights(today, have || [], lookback);
      if (nights.length === 0) continue;
      if (lookback > LOOKBACK_DAYS) backfilled += 1;

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
  return { athletes: (athletes || []).length, fetched, stored, backfilled, failed };
}

/**
 * One athlete's one night, now — the morning reminder's (lib/academy/morning-reminder-server)
 * look at a night the 05:40 UTC sweep has not reached yet. Stored like the sweep stores it,
 * so the home and the body screen see it too. Null on no Garmin, a timeout or any error:
 * the reminder then simply leaves its third line out.
 */
export async function fetchNight(
  supabase: SupabaseClient,
  athleteId: string,
  date: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ sleep_seconds: number | null; resting_hr: number | null } | null> {
  try {
    const { data: athlete } = await supabase.from('athletes').select('garmin_auth').eq('id', athleteId).maybeSingle();
    const auth = (athlete as { garmin_auth?: unknown } | null)?.garmin_auth;
    if (!auth) return null;
    const client = new GarminClient(auth as any);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), opts.timeoutMs ?? 3000); });
    const w = await Promise.race([client.getWellness(date), timeout]).finally(() => clearTimeout(timer));
    if (!w) return null;
    const row = { sleep_seconds: w.sleepSeconds, resting_hr: w.restingHr };
    await supabase.from('athlete_wellness').upsert(
      { athlete_id: athleteId, date, ...row, fetched_at: new Date().toISOString() },
      { onConflict: 'athlete_id,date' },
    );
    return row;
  } catch {
    return null;
  }
}
