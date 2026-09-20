/**
 * "What is my next session, and is it on my watch?" — the selector behind the
 * feed's small upcoming-workout box.
 *
 * The rules are his, and each one is a decision about WHEN the box is useful:
 *
 *  - It opens at 20:00 the evening before. Earlier than that, tomorrow is not
 *    actionable yet and the box would sit on the feed all day saying the same
 *    thing; 20:00 is also the hour the dashboard hero rolls over
 *    (EVENING_LOOKAHEAD_HOUR), so the two screens never name different sessions.
 *  - It disappears once the session is done. The box exists to prompt something —
 *    check the watch, go run — so after the run it is only clutter on the one
 *    screen the club scrolls most.
 *  - A double day is two sessions, not one. Run the first and the box switches to
 *    the second instead of vanishing, which is the whole reason it counts sessions
 *    rather than asking "did they run today".
 *
 * Pure, and generic over the session type: the caller passes Israel's date/hour,
 * a lookup from date to that day's sessions, and the day's logged kilometres. So
 * this is testable without a clock, gives the same answer in any viewer's
 * timezone, and hands back the caller's OWN session object — the feed box needs
 * the steps and the morning/evening kind to draw itself, and re-deriving those
 * from a copy is how two screens start disagreeing about the same session.
 */

/** The little this selector itself needs to know about a session. */
export interface SessionLike {
  /** Kilometres at the bottom of the session's range — what "done" is measured against. */
  kmMin: number;
}

export interface NextSession<S extends SessionLike> {
  /** YYYY-MM-DD the session falls on. */
  date: string;
  /** Is that date the caller's today (vs tomorrow) — the box's own wording hangs off this. */
  isToday: boolean;
  session: S;
  /** 1-based position within the day, and how many the day has: "2 of 2" on a double. */
  index: number;
  total: number;
}

/**
 * A run shorter than this doesn't retire a planned session.
 *
 * Sessions are matched to runs by COUNT, which is what makes a double work, and
 * the cost of that is that any logged run would otherwise tick one off. A
 * kilometre is the floor at which something is plausibly a session and not a
 * stray GPS trace, a treadmill test or a walk home that Garmin filed as a run.
 * The bias is deliberate: leaving the box up one run too long costs a glance,
 * hiding it early costs the athlete the watch check it exists for.
 */
export const SESSION_MIN_KM = 1;

/** From this Israel hour, "next" means tomorrow. Same constant the dashboard uses. */
export const EVENING_LOOKAHEAD_HOUR = 20;

/**
 * How many of the day's sessions the athlete has already done.
 *
 * Two ways to be finished, because a double can be run either way: as two
 * separate runs (count them) or as one continuous session that covers the day's
 * whole target (compare the kilometres). Without the second test an athlete who
 * merges a double into one long run would be shown the "second" session they had
 * just finished.
 */
export function sessionsDone<S extends SessionLike>(sessions: S[], runsKm: number[]): number {
  if (sessions.length === 0) return 0;
  const counted = runsKm.filter((km) => km >= SESSION_MIN_KM);
  const dayMin = sessions.reduce((s, x) => s + x.kmMin, 0);
  const totalKm = counted.reduce((s, km) => s + km, 0);
  if (dayMin > 0 && totalKm >= dayMin) return sessions.length;
  return Math.min(counted.length, sessions.length);
}

/**
 * @param todayKey     Israel's date today, YYYY-MM-DD
 * @param tomorrowKey  Israel's date tomorrow
 * @param hour         Israel's hour now, 0-23
 * @param sessionsFor  that date's sessions, in the order they are run
 * @param runsKmByDate kilometres of each run already logged, keyed by Israel date
 */
export function pickNextSession<S extends SessionLike>({
  sessionsFor, todayKey, tomorrowKey, hour, runsKmByDate,
}: {
  sessionsFor: (dateKey: string) => S[];
  todayKey: string;
  tomorrowKey: string;
  hour: number;
  runsKmByDate: Record<string, number[]>;
}): NextSession<S> | null {
  const todaySessions = sessionsFor(todayKey);
  const doneToday = sessionsDone(todaySessions, runsKmByDate[todayKey] || []);
  const remainingToday = todaySessions.length - doneToday;
  const owedToday = (): NextSession<S> => ({
    date: todayKey, isToday: true, session: todaySessions[doneToday],
    index: doneToday + 1, total: todaySessions.length,
  });

  // After 20:00 the day is over whether or not it was run: a session still marked
  // pending at 22:00 was skipped or shortened, and telling somebody to go and do it
  // is worse than showing them what is actually next.
  if (hour >= EVENING_LOOKAHEAD_HOUR) {
    const tomorrowSessions = sessionsFor(tomorrowKey);
    if (tomorrowSessions.length > 0) {
      return {
        date: tomorrowKey, isToday: false, session: tomorrowSessions[0],
        index: 1, total: tomorrowSessions.length,
      };
    }
    // Nothing tomorrow. A session still owed TODAY is the only thing left worth
    // saying, and only until midnight.
    return remainingToday > 0 ? owedToday() : null;
  }

  if (remainingToday > 0) return owedToday();
  // Today is done (or was a rest day) and it is not yet evening — the box has
  // nothing to prompt, so it renders nothing at all rather than an empty shell.
  return null;
}
