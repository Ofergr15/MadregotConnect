import { createServerClient } from '@/lib/supabase/server';
import { getDisplayWeekStart } from '@/lib/plans/workout-parsing';
import { israelToday } from '@/lib/utils';
import { readDaySession } from '@/lib/day-session/server';
import { startDaySessionSend } from '@/lib/day-session/watch';
import { missingForAthletes } from './missing';
import { pushOwnWeek } from './own-week';

// A runner reconnects Garmin → what was waiting for them goes to the watch by itself
// (mockup watch-send-next, A3): the one-day sessions they were sent, and the club week the
// coach sent, from today on. Answers how many days went, for the "האימונים שחיכו נשלחו לשעון
// שלך" line on the screen that just connected them.

export async function sendWaitingAfterReconnect(athleteId: string): Promise<number> {
  const db = createServerClient();
  const { data: athlete } = await db.from('athletes').select('id, garmin_auth').eq('id', athleteId).maybeSingle();
  if (!athlete?.garmin_auth) return 0;
  const weekStart = getDisplayWeekStart(new Date());
  const m = (await missingForAthletes([athlete], weekStart, israelToday(), db)).get(athleteId);
  if (!m?.missing.length) return 0;

  const { data: dayRows } = await db.from('workout_deliveries').select('workout_date')
    .eq('athlete_id', athleteId).is('plan_id', null).like('workout_key', 'day:%').in('workout_date', m.missing);
  const dayDates = new Set(((dayRows || []) as Array<{ workout_date: string }>).map((r) => r.workout_date));

  let sent = 0;
  for (const date of dayDates) {
    const { session } = await readDaySession(date);
    if (!session?.publishedAt || !session.steps.length) continue;
    const { queued, work } = await startDaySessionSend(session, [athleteId], null);
    await work;
    sent += queued;
  }
  if (m.missing.some((d) => !dayDates.has(d))) {
    const r = await pushOwnWeek(athleteId, weekStart);
    if (r.status === 'ok') sent += m.missing.filter((d) => !dayDates.has(d)).length;
  }
  return sent;
}

/** At most `ms`: a reconnect screen must never hang on Garmin. */
export async function withinMs<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}
