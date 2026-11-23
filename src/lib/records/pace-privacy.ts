import type { SupabaseClient } from '@supabase/supabase-js';
import { hidesPace } from './board';

/**
 * Record times and "hide pace" (owner decision, 2026-11-23).
 *
 * A record is a time over a fixed distance — pace at a coarser grain — so a runner
 * whose `athletes.default_hidden_fields` holds `pace` has their record times withheld
 * from teammates, exactly as the feed's `pace` hidden field withholds a run's pace.
 * The runner and staff (`mayActFor`) keep everything; the owner's own `?as=member`
 * preview is masked like a teammate.
 *
 * Fails CLOSED: a read that errors, throws or finds no row reports `true`, because
 * "could not tell" must not publish what the runner hid (lib/activities/hidden-stats.ts).
 * The one exception is a missing column (193 not pasted): then the setting does not
 * exist, nobody can have turned it on, and the record tables (lib/records/server.ts
 * readRoster) read it the same way.
 */
export async function athleteHidesPace(db: SupabaseClient, athleteId: string): Promise<boolean> {
  try {
    const { data, error } = await db.from('athletes').select('default_hidden_fields').eq('id', athleteId).maybeSingle();
    if (error) return !(error.code === '42703' || error.code === 'PGRST204');
    if (!data) return true;
    return hidesPace((data as { default_hidden_fields?: unknown }).default_hidden_fields);
  } catch {
    return true;
  }
}

/** A record with its time withheld: the distance and label stay; the time, and the
 * date and run it came from (which lead straight back to the time), go. */
export function maskRecordTime<T extends { seconds: number | null }>(pr: T): T & { paceHidden: true } {
  const out: Record<string, unknown> = { ...pr, seconds: null, paceHidden: true };
  for (const k of ['date', 'activityId', 'activityName', 'fromSegment', 'sourceMeters'] as const) if (k in out) out[k] = k === 'fromSegment' ? false : null;
  return out as T & { paceHidden: true };
}
