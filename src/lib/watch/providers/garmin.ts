import { pushWeekToAthlete } from '@/lib/garmin/push-week';
import type { DeliverWeekInput, DeliverWeekResult, WatchProviderAdapter, WatchTargetAthlete } from '../types';

/**
 * The Garmin provider is `pushWeekToAthlete`, unchanged — this file only gives it
 * the provider shape. Every rule about when a Garmin delivery may be called a
 * success (pending rows, the read-back, the promotion, the notification after
 * verification) stays in lib/garmin/push-week.ts, which this does not touch.
 *
 * The coach route and the athlete route still CALL `pushWeekToAthlete({...})`
 * directly on their Garmin branch (pinned by myWatch.test.ts: one implementation,
 * two callers). This adapter is for callers that dispatch by provider.
 */
export const garminProvider: WatchProviderAdapter = {
  id: 'garmin',
  isConnected: (athlete: WatchTargetAthlete) => !!athlete.garmin_auth,
  async deliverWeek(input: DeliverWeekInput): Promise<DeliverWeekResult> {
    const result = await pushWeekToAthlete({
      supabase: input.supabase,
      athlete: input.athlete,
      plannedWorkouts: input.plannedWorkouts,
      weekStartDate: input.weekStartDate,
      planId: input.planId,
      paceTarget: input.paceTarget,
      notify: input.notify,
      cleanDayOnce: input.cleanDayOnce,
      pushCopy: input.pushCopy,
    });
    return { ...result, provider: 'garmin' };
  },
};
