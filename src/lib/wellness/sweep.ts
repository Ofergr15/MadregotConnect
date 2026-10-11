import type { SupabaseClient } from '@supabase/supabase-js';
import { GarminClient } from '@/lib/garmin/client';
import { israelToday } from '@/lib/utils';
import { isPartialNight } from '@/lib/academy/normal-range';

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
 *
 * ONE, and then not again for BACKFILL_RETRY_DAYS: a watch that records no sleep (or is not
 * worn at night) stays short of 14 nights whatever is asked, and re-asking Garmin 30 nights
 * of nothing every night would also hold the run's few slots against everyone after it.
 * The record that a pass happened needs no column — the pass stores every night it asked
 * for, nulls included, and only a deep pass ever stores a night fetched more than a week
 * after it (`lastDeepPassAt`). The slots go to whoever was deep-passed longest ago, never
 * first.
 */
export const BACKFILL_LOOKBACK_DAYS = 30;
export const BACKFILL_MIN_NIGHTS = 14;
export const WELLNESS_BACKFILL_PER_RUN = 5;
export const BACKFILL_RETRY_DAYS = 30;

/** YYYY-MM-DD `n` days before `date`. */
export function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const dayGap = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

type StoredNight = { date: string; sleep_seconds: number | null; resting_hr: number | null; fetched_at?: string | null };

/**
 * The dates in the window with no value yet, newest first — and a night that arrived cut
 * short (normal-range.ts `isPartialNight`: sleep without the morning's RHR on a watch that
 * records it, or under 3 hours read before 07:00), which is asked again so it is whole by
 * the time anyone judges it.
 */
export function missingNights(
  today: string,
  stored: StoredNight[],
  lookback: number = LOOKBACK_DAYS,
): string[] {
  const done = new Set(stored
    .filter(r => (r.sleep_seconds != null || r.resting_hr != null) && !(r.date >= daysBefore(today, 1) && isPartialNight(r, stored)))
    .map(r => r.date));
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
 * When this athlete last had a deep pass (YYYY-MM-DD), or null for never: the latest
 * `fetched_at` of a night fetched more than LOOKBACK_DAYS after it — the week's sweep
 * never reaches that far back, so only a deep pass writes one.
 */
export function lastDeepPassAt(stored: StoredNight[]): string | null {
  let last: string | null = null;
  for (const r of stored) {
    if (!r.fetched_at) continue;
    const at = String(r.fetched_at).slice(0, 10);
    if (dayGap(r.date, at) > LOOKBACK_DAYS && (!last || at > last)) last = at;
  }
  return last;
}

/**
 * Who may have a deep pass tonight: an academy trainee whose range is still being learned
 * and who has not had one in BACKFILL_RETRY_DAYS.
 */
export function needsDeepPass(input: { isAcademy: boolean; storedIn30: number; lastDeepPass: string | null; today: string }): boolean {
  return input.isAcademy
    && input.storedIn30 < BACKFILL_MIN_NIGHTS
    && (input.lastDeepPass == null || dayGap(input.lastDeepPass, input.today) >= BACKFILL_RETRY_DAYS);
}

/**
 * The run's WELLNESS_BACKFILL_PER_RUN slots: never-passed first, then the longest ago, the
 * athlete order breaking ties — so one stuck trainee can never hold a slot two runs in a
 * row against the ones after it.
 */
export function deepPassPicks(candidates: Array<{ id: string; lastDeepPass: string | null }>, slots = WELLNESS_BACKFILL_PER_RUN): Set<string> {
  const order = candidates
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => (a.lastDeepPass ?? '') < (b.lastDeepPass ?? '') ? -1 : (a.lastDeepPass ?? '') > (b.lastDeepPass ?? '') ? 1 : a.i - b.i);
  return new Set(order.slice(0, slots).map(c => c.id));
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

  // A deep pass up to BACKFILL_RETRY_DAYS ago stored nights up to BACKFILL_LOOKBACK_DAYS
  // before it; read that far so the record of the last pass is in view.
  const since = daysBefore(today, BACKFILL_RETRY_DAYS + BACKFILL_LOOKBACK_DAYS - 1);
  let fetched = 0;
  let stored = 0;
  let backfilled = 0;
  /** Nights Garmin answered with an error (not "nothing that night"). */
  let nightErrors = 0;
  const failed: string[] = [];

  // ── What each athlete has, and who gets tonight's deep passes ──
  const list = (athletes || []) as Array<{ id: string; garmin_auth: unknown; is_academy?: boolean | null }>;
  const haves = new Map<string, StoredNight[]>();
  const candidates: Array<{ id: string; lastDeepPass: string | null }> = [];
  for (const athlete of list) {
    try {
      const { data: have } = await supabase
        .from('athlete_wellness')
        .select('date, sleep_seconds, resting_hr, fetched_at')
        .eq('athlete_id', athlete.id)
        .gte('date', since);
      const rows = (have || []) as StoredNight[];
      haves.set(athlete.id, rows);
      const lastDeepPass = lastDeepPassAt(rows);
      if (needsDeepPass({ isAcademy: !!athlete.is_academy, storedIn30: storedNightCount(today, rows), lastDeepPass, today })) {
        candidates.push({ id: athlete.id, lastDeepPass });
      }
    } catch (e) {
      failed.push(`${athlete.id}: ${(e as Error).message}`);
    }
  }
  const deep = deepPassPicks(candidates);

  for (const athlete of list) {
    const have = haves.get(athlete.id);
    if (!have) continue;
    try {
      const lookback = deep.has(athlete.id) ? BACKFILL_LOOKBACK_DAYS : LOOKBACK_DAYS;
      const nights = missingNights(today, have, lookback);
      if (nights.length === 0) continue;
      if (lookback > LOOKBACK_DAYS) backfilled += 1;

      const client = new GarminClient(athlete.garmin_auth as any);
      const rows: Array<{ athlete_id: string; date: string; sleep_seconds: number | null; resting_hr: number | null; fetched_at: string }> = [];
      let errors = 0;
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
          // One night failing (Garmin 5xx, rate limit) must not cost the rest — but it is
          // counted, so a sweep where every call threw does not read as a clean night.
          errors += 1;
        }
      }
      nightErrors += errors;
      if (errors && !rows.length) failed.push(`${athlete.id}: all ${errors} night${errors === 1 ? '' : 's'} failed`);
      // A deep pass leaves its record even when Garmin failed every call: one empty row for
      // the deep window's oldest night (never over a stored value), which `lastDeepPassAt`
      // reads, so the same trainees are not deep-passed again every night.
      if (lookback > LOOKBACK_DAYS && !rows.some(r => dayGap(r.date, r.fetched_at) > LOOKBACK_DAYS)) {
        const oldest = daysBefore(today, BACKFILL_LOOKBACK_DAYS - 1);
        if (!have.some(r => r.date === oldest && (r.sleep_seconds != null || r.resting_hr != null)) && !rows.some(r => r.date === oldest)) {
          rows.push({ athlete_id: athlete.id, date: oldest, sleep_seconds: null, resting_hr: null, fetched_at: new Date().toISOString() });
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
  return { athletes: list.length, fetched, stored, backfilled, nightErrors, failed };
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
