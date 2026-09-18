import type { createServerClient } from '@/lib/supabase/server';
import { backfillGarminHistory, type AthleteHistoryResult } from './history-backfill';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * Drive the Garmin history walk from the schedule instead of by hand, and record
 * how far it got so the athlete can be told when their past is fully imported.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `history-backfill.ts` can already import an athlete's runs from before the day
 * they connected, and it is resumable: it returns `nextPage`, the offset to pick
 * up from. But nothing persisted that number. The only caller was
 * `PATCH /api/garmin/sync-activities?mode=history`, which means every page past
 * the first three had to be requested by a human reading `nextPage` out of the
 * previous response and typing it into the next one — per athlete, twenty-odd
 * times over. Reported as: "pull automatically behind the scenes, and backwards
 * too, and mark to the user that we pulled everything, and let it all run with no
 * manual intervention."
 *
 * So the cursor lives in `app_settings` under one key, as JSON keyed by athlete.
 * `app_settings` rather than a new column because it needs no migration — the
 * migrations here are pasted into the SQL editor by hand, and a feature that
 * cannot ship until someone does that is a feature that stays unshipped. Nothing
 * here is athlete-facing truth either: it is bookkeeping about a walk, and a lost
 * cursor costs one repeated page (`garmin_activity_id` de-duplicates) rather than
 * a wrong number on a screen.
 *
 * ── THE BUDGET ─────────────────────────────────────────────────────────────
 * ONE athlete, TWO pages per tick. `/api/cron/sync` fires every five minutes
 * across a twenty-hour window (~240 ticks/day) and `MAX_PAGE` in the backfill is
 * 50, so the deepest possible athlete drains in 25 ticks and the whole club —
 * about two dozen athletes — inside three days, after which this returns null
 * forever. Deliberately the smallest budget that still finishes: this shares the
 * club's single Garmin credential with the sync pass that is the actual point of
 * the tick, and it is repairing history, which has waited months already and can
 * wait another hour.
 *
 * Athletes are taken oldest-cursor-first, so a revoked credential that errors
 * every time goes to the back of the queue instead of blocking everyone behind
 * it — the failure mode of a "first incomplete athlete" pick.
 */

/** `app_settings.key` holding the per-athlete walk cursor. */
export const HISTORY_CURSOR_KEY = 'garmin_history_cursor';

/** Athletes advanced per tick. One: see the budget note above. */
const ATHLETES_PER_TICK = 1;

/** Garmin list pages per athlete per tick. */
const PAGES_PER_TICK = 2;

/** Where one athlete's backwards walk has got to. */
export interface AthleteHistoryCursor {
  /** Next page to fetch, or null when Garmin has no older page to give. */
  page: number | null;
  /** Rows this walk has inserted in total, across every tick. */
  imported: number;
  /** Garmin list pages fetched in total. */
  pages: number;
  /** Oldest `start_time` stored for the athlete as of the last tick. */
  oldest: string | null;
  updatedAt: string;
  /** Last failure, kept so a stuck athlete is visible without reading logs. */
  error?: string | null;
}

export type HistoryCursors = Record<string, AthleteHistoryCursor>;

/**
 * What the athlete is told. `complete` is the only claim worth making and the
 * whole point of the report; `importing` is honest about a walk in progress
 * rather than silent; `none` covers an athlete with no Garmin credential and an
 * athlete the schedule has simply not reached yet — in both cases there is
 * nothing true to say, so the UI says nothing.
 */
export type HistoryImportState = 'none' | 'importing' | 'complete';

export interface HistoryImportStatus {
  state: HistoryImportState;
  /** Oldest activity now stored — the "we have you back to here" date. */
  oldest: string | null;
  /** How many old runs this walk added for the athlete. */
  imported: number;
}

/** The cursor map, or `{}` when the key is absent or unparseable. */
export async function readHistoryCursors(supabase: SupabaseServer): Promise<HistoryCursors> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', HISTORY_CURSOR_KEY)
    .maybeSingle();
  if (!data?.value) return {};
  try {
    const parsed = JSON.parse(data.value);
    return parsed && typeof parsed === 'object' ? (parsed as HistoryCursors) : {};
  } catch {
    return {};
  }
}

async function writeHistoryCursors(supabase: SupabaseServer, cursors: HistoryCursors): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key: HISTORY_CURSOR_KEY, value: JSON.stringify(cursors), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  if (error) throw error;
}

/**
 * One athlete's cursor → what to show them. Pure, so the copy can be tested
 * without a database.
 *
 * `hasGarmin` false is `none` even when a cursor exists: an athlete who has since
 * disconnected must not be shown a claim about a credential they revoked.
 */
export function historyImportStatus(
  cursor: AthleteHistoryCursor | undefined,
  hasGarmin: boolean,
): HistoryImportStatus {
  if (!hasGarmin || !cursor) return { state: 'none', oldest: null, imported: 0 };
  return {
    state: cursor.page == null ? 'complete' : 'importing',
    oldest: cursor.oldest ?? null,
    imported: cursor.imported || 0,
  };
}

export interface ScheduledHistoryResult {
  /** Athletes still carrying an unfinished cursor AFTER this tick. */
  remaining: number;
  athletes: AthleteHistoryResult[];
  imported: number;
}

/**
 * Advance the club's history import by one tick's budget.
 *
 * Returns null when there is nothing left to do — every athlete with a Garmin
 * credential has been walked to the end — so the caller can stay silent in the
 * drained case, as the Strava backfills beside it already do.
 */
export async function runScheduledHistoryBackfill(
  supabase: SupabaseServer,
): Promise<ScheduledHistoryResult | null> {
  const { data: athletes, error } = await supabase
    .from('athletes')
    .select('id')
    .not('garmin_auth', 'is', null);
  if (error) throw error;
  const ids = ((athletes || []) as Array<{ id: string }>).map((a) => a.id);
  if (ids.length === 0) return null;

  const cursors = await readHistoryCursors(supabase);

  // Unfinished = no cursor at all (never walked) or a cursor with a page left.
  // Oldest-touched first, and never-walked athletes sort ahead of everyone, so a
  // new member's history starts on the tick after they connect.
  const unfinished = (id: string) => !cursors[id] || cursors[id].page != null;
  const pending = ids
    .filter(unfinished)
    .sort((a, b) => (cursors[a]?.updatedAt || '').localeCompare(cursors[b]?.updatedAt || ''));
  if (pending.length === 0) return null;

  const results: AthleteHistoryResult[] = [];
  for (const athleteId of pending.slice(0, ATHLETES_PER_TICK)) {
    const cursor = cursors[athleteId];
    let result: AthleteHistoryResult;
    try {
      const walk = await backfillGarminHistory(supabase, {
        athleteId,
        maxPages: PAGES_PER_TICK,
        fromPage: cursor?.page ?? 1,
      });
      // One athlete was asked for, so one result comes back. An athlete whose row
      // vanished between the two reads yields none; treat that as done.
      result = walk.athletes[0] ?? {
        athleteId, name: null, imported: 0, scanned: 0, pagesFetched: 0, oldestStored: null, nextPage: null,
      };
    } catch (e) {
      // Keep the page where it was so the next tick retries the same offset, and
      // let the sort send this athlete to the back of the queue meanwhile.
      result = {
        athleteId, name: null, imported: 0, scanned: 0, pagesFetched: 0,
        oldestStored: cursor?.oldest ?? null,
        nextPage: cursor?.page ?? 1,
        error: (e as Error).message,
      };
    }
    results.push(result);
    cursors[athleteId] = {
      page: result.nextPage,
      imported: (cursor?.imported || 0) + result.imported,
      pages: (cursor?.pages || 0) + result.pagesFetched,
      oldest: result.oldestStored ?? cursor?.oldest ?? null,
      updatedAt: new Date().toISOString(),
      error: result.error ?? null,
    };
  }

  await writeHistoryCursors(supabase, cursors);

  const remaining = ids.filter(unfinished).length;
  return {
    remaining,
    athletes: results,
    imported: results.reduce((sum, r) => sum + r.imported, 0),
  };
}
