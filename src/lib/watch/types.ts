import type { ParsedWorkout } from '@/lib/ai/types';
import type { createServerClient } from '@/lib/supabase/server';
import type { PushResult, PushTargetAthlete } from '@/lib/garmin/push-week';

/**
 * Which watch a delivery goes to.
 *
 * `garmin` is the existing path: two writes to the athlete's Garmin Connect
 * account plus a read-back (lib/garmin/push-week.ts). `apple` has no cloud API at
 * all — Apple exposes WorkoutKit only on the device — so an Apple delivery is a
 * row the athlete's iPhone app pulls from `GET /api/device/pending-workouts` and
 * hands to `WorkoutScheduler`. See docs/apple-watch.md.
 */
export type WatchProvider = 'garmin' | 'apple';

export const WATCH_PROVIDERS: readonly WatchProvider[] = ['garmin', 'apple'];

export type Db = ReturnType<typeof createServerClient>;

/** The athlete row a delivery needs. A superset of the Garmin pusher's own shape. */
export interface WatchTargetAthlete extends PushTargetAthlete {
  max_hr_bpm?: number | null;
}

/** Everything a week delivery takes — identical to `pushWeekToAthlete`'s arguments. */
export interface DeliverWeekInput {
  supabase: Db;
  athlete: WatchTargetAthlete;
  plannedWorkouts: ParsedWorkout[];
  weekStartDate: string;
  planId: string | null;
  /** Whether alerts (pace/HR range) are allowed — the academy gate, unchanged. */
  paceTarget: boolean;
  notify?: boolean;
  cleanDayOnce?: boolean;
}

/**
 * The Garmin result, plus one honest flag for a provider that cannot confirm at
 * push time. `queued: true` means "written for the phone to collect", never "on
 * the watch" — that only becomes true when the phone acks, which is what
 * flips the row to 'success' and what `/api/my-watch` reads.
 */
export interface DeliverWeekResult extends PushResult {
  provider: WatchProvider;
  queued?: boolean;
}

export interface WatchProviderAdapter {
  id: WatchProvider;
  /** A cheap, synchronous read off the athlete row (no I/O). */
  isConnected(athlete: WatchTargetAthlete, ctx?: { appleAthleteIds?: ReadonlySet<string> }): boolean;
  deliverWeek(input: DeliverWeekInput): Promise<DeliverWeekResult>;
}
