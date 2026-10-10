import { appleProvider, loadAppleAthleteIds } from './providers/apple';
import { garminProvider } from './providers/garmin';
import type { DeliverWeekInput, DeliverWeekResult, WatchProvider, WatchProviderAdapter, WatchTargetAthlete } from './types';

export type { WatchProvider, WatchProviderAdapter, DeliverWeekInput, DeliverWeekResult, WatchTargetAthlete } from './types';
export { loadAppleAthleteIds };

export const WATCH_ADAPTERS: Record<WatchProvider, WatchProviderAdapter> = {
  garmin: garminProvider,
  apple: appleProvider,
};

/**
 * Which provider a week goes to. Pure.
 *
 * Garmin is decided by the athlete row alone and always wins: an athlete with a
 * Garmin connection is routed exactly as before this module existed, with no new
 * query on their path. Only an athlete WITHOUT one is looked up for an Apple
 * device (`loadAppleAthleteIds`), and if they have none they still fall to
 * 'garmin', whose answer for them is today's "No Garmin auth token" failure.
 */
export function resolveWatchProvider(
  athlete: WatchTargetAthlete,
  appleAthleteIds: ReadonlySet<string> = new Set(),
): WatchProvider {
  if (garminProvider.isConnected(athlete)) return 'garmin';
  if (appleProvider.isConnected(athlete, { appleAthleteIds })) return 'apple';
  return 'garmin';
}

/** The ids `resolveWatchProvider` needs: only athletes with no Garmin link are looked up. */
export async function appleCandidates(
  supabase: DeliverWeekInput['supabase'],
  athletes: WatchTargetAthlete[],
): Promise<Set<string>> {
  return loadAppleAthleteIds(
    supabase,
    athletes.filter((a) => !garminProvider.isConnected(a)).map((a) => a.id),
  );
}

export function deliverWeek(provider: WatchProvider, input: DeliverWeekInput): Promise<DeliverWeekResult> {
  return WATCH_ADAPTERS[provider].deliverWeek(input);
}
