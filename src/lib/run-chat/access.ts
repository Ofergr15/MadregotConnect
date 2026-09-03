import type { SessionUser } from '@/lib/auth-session';

export interface RunChat {
  id: string;
  activity_id: string;
  athlete_id: string;
  coach_id: string | null;
  stream_channel_id: string | null;
  planned_text: string | null;
  planned_workout: unknown | null;
  created_at: string;
}

/**
 * Returns true if `user` is allowed to view/interact with `chat`.
 * - Runner: owns the activity
 * - Staff (coach / academy_coach / admin): any run chat — coaches start/continue
 *   threads with every runner
 */
export function canAccessChat(
  user: SessionUser,
  chat: Pick<RunChat, 'athlete_id' | 'coach_id'>,
): boolean {
  if (user.isStaff) return true;
  if (user.athleteId && user.athleteId === chat.athlete_id) return true;
  if (user.athleteId && user.athleteId === chat.coach_id) return true;
  return false;
}

/**
 * Who may rebuild the plan card with a prompt: staff, or the runner whose
 * activity this chat belongs to (their own plan, verified server-side).
 */
export function canEditChatPlan(
  user: Pick<SessionUser, 'isStaff' | 'athleteId'>,
  chat: Pick<RunChat, 'athlete_id'>,
): boolean {
  if (user.isStaff) return true;
  return Boolean(user.athleteId && user.athleteId === chat.athlete_id);
}
