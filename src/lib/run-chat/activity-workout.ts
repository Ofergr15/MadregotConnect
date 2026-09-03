import { formatPace, paceSeconds } from './run-analysis';
import type { PlannedWorkout } from './mock-workout';

export const UNMATCHED_PLAN_TITLE = 'אין תוכנית תואמת';
export const UNMATCHED_PLAN_TEXT = 'לא נמצאה תוכנית אימון שפורסמה ותואמת לריצה הזו.';

export function isUnresolvedPlan(
  workout: PlannedWorkout | null | undefined,
  text?: string | null,
): boolean {
  if (!workout && !text) return true;
  if (workout?.title === UNMATCHED_PLAN_TITLE) return true;
  if (text === UNMATCHED_PLAN_TEXT) return true;
  const source = workout?.source;
  if (source && typeof source === 'object' && source.matchMethod === 'activity') return true;
  return false;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function plannedWorkoutFromActivity(activity: {
  activity_name?: string | null;
  distance?: number | null;
  duration?: number | null;
  moving_duration?: number | null;
  average_pace?: number | null;
  average_hr?: number | null;
}): PlannedWorkout {
  const duration = activity.moving_duration || activity.duration || 0;
  const distance = activity.distance || 0;
  const paceSec = activity.average_pace || paceSeconds(distance, duration);
  const km = distance ? Math.round((distance / 1000) * 10) / 10 : null;
  const parts = [
    km ? `${km} km` : null,
    duration ? formatDuration(duration) : null,
    formatPace(paceSec),
    activity.average_hr ? `${Math.round(activity.average_hr)} bpm` : null,
  ].filter(Boolean);
  const title = activity.activity_name?.trim() || 'ריצה';
  const prompt = parts.join(', ') || title;
  return {
    title,
    prompt,
    source: { matchMethod: 'activity' },
    segments: [
      {
        kind: 'easy',
        label: 'Run',
        detail: prompt,
        distanceM: distance || undefined,
        durationSec: duration || undefined,
        targetPaceSec: paceSec ? Math.round(paceSec) : undefined,
      },
    ],
  };
}
