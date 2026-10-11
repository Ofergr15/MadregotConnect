import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { DATA_FEED_COLUMNS, DATA_FEED_COLUMNS_FALLBACK, canReceiveWatch, nightFeed, runFeed, type DataFeed, type FeedRow } from './data-feed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export interface AthleteFeeds {
  /** Runs (Garmin or Strava). */
  run: DataFeed;
  /** Nights (Garmin only). */
  night: DataFeed;
  /** A workout can be sent to this trainee's watch. */
  canWatch: boolean;
}

/** One athlete's provider columns, decided (data-feed.ts). A read error reads as "nothing connected". */
export async function loadAthleteFeeds(db: Db, athleteId: string, now: number = Date.now()): Promise<AthleteFeeds> {
  let row: FeedRow | null = null;
  try {
    const primary = await db.from('athletes').select(DATA_FEED_COLUMNS).eq('id', athleteId).maybeSingle();
    if (primary.error && isMissingColumn(primary.error)) {
      const fallback = await db.from('athletes').select(DATA_FEED_COLUMNS_FALLBACK).eq('id', athleteId).maybeSingle();
      row = fallback.error ? null : (fallback.data as FeedRow | null);
    } else {
      row = primary.error ? null : (primary.data as FeedRow | null);
    }
  } catch {
    row = null;
  }
  return { run: runFeed(row, now), night: nightFeed(row, now), canWatch: canReceiveWatch(row, now) };
}
