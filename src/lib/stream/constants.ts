/** Shared Stream Chat constants — safe to import from client components. */

export const CHANNEL_TYPE = 'messaging' as const;
export const AI_USER_ID = 'aicoach';

export function channelId(activityId: string) {
  return `run-${activityId}`;
}
