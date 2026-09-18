/**
 * What's coming up for the club, split into the three lanes people actually ask
 * about: races, club events, and birthdays.
 *
 * Requested as "אירועים קרובים — Section חדש איכותי עם הפרדה בין אירועי קבוצה,
 * מירוצים, ואירועים כמו ימי הולדת". The separation is the feature: a race you
 * train months for and a social evening next Tuesday are not the same kind of
 * thing, and merging them into one date-sorted list is what made the calendar
 * unreadable as a "what's next" answer.
 *
 * Pure on purpose — every date rule here (which birthday is next, how far away a
 * date is, what counts as still upcoming) is arithmetic that used to be wrong by
 * one day in a timezone ahead of UTC, so it is testable without a database or a
 * browser. Callers pass today's date as an Israel-local ISO day; nothing in here
 * ever reads the clock.
 */

/** An events-table row, narrowed to what a compact upcoming row renders. */
export interface UpcomingEventInput {
  id: string;
  kind: string;
  name: string;
  date: string;
  end_date?: string | null;
  start_time?: string | null;
  location?: string | null;
  distances?: string[] | null;
}

export interface UpcomingEvent extends UpcomingEventInput {
  /** Whole days from today. 0 = today, never negative. */
  daysAway: number;
}

export interface BirthdayAthleteInput {
  id: string;
  name: string | null;
  birth_date?: string | null;
  status?: string | null;
}

/**
 * A birthday, carrying the DAY it falls on and no year.
 *
 * The year is deliberately dropped before this leaves the server: a birthday card
 * needs "Roy, in 4 days", and the year would hand every member the exact age of
 * everyone else — which is not what anyone asked for and not ours to publish.
 */
export interface UpcomingBirthday {
  athleteId: string;
  name: string;
  /** Next occurrence, as a local ISO day. */
  date: string;
  daysAway: number;
}

export interface UpcomingBuckets {
  races: UpcomingEvent[];
  club: UpcomingEvent[];
  birthdays: UpcomingBirthday[];
}

const DAY_MS = 86_400_000;

/** Local-date ISO — never toISOString(), which shifts the day in Israel (+2/+3). */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Midday, so a DST boundary can never round a date to the previous day. */
function atNoon(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((atNoon(to).getTime() - atNoon(from).getTime()) / DAY_MS);
}

/**
 * The next occurrence of a birthday, on or after `today`.
 *
 * Feb 29 lands on Mar 1 in a common year: the alternative (Feb 28) moves the
 * greeting a day EARLIER than the real date, and a birthday that arrives late is
 * a smaller wrong than one that arrives before it happened.
 */
export function nextBirthday(birthDate: string, today: string): string | null {
  const born = atNoon(birthDate.slice(0, 10));
  if (Number.isNaN(born.getTime())) return null;

  const month = born.getMonth();
  const day = born.getDate();
  const todayDate = atNoon(today);

  for (let year = todayDate.getFullYear(); year <= todayDate.getFullYear() + 1; year++) {
    const candidate = new Date(year, month, day, 12, 0, 0);
    // A Feb 29 in a common year rolls over to Mar 1 by construction — new Date()
    // normalises it — which is exactly the behaviour documented above.
    if (candidate.getTime() >= todayDate.getTime()) return iso(candidate);
  }
  return null;
}

/** A club event is over once its LAST day has passed, not its first. */
function stillUpcoming(event: UpcomingEventInput, today: string): boolean {
  const last = event.end_date || event.date;
  return daysBetween(today, last) >= 0;
}

export interface BuildUpcomingInput {
  events: UpcomingEventInput[];
  athletes: BirthdayAthleteInput[];
  /** Israel-local ISO day. */
  today: string;
  /** Rows kept per lane. The card is a teaser; the calendar is the full list. */
  perLane?: number;
  /**
   * How far ahead a birthday counts as "upcoming".
   *
   * Shorter than the race horizon on purpose: a race in three months is
   * something to train for, a birthday in three months is noise, and with 17
   * birthdays on the roster a long window would leave this lane permanently
   * full while the lanes people opened the card for sit below it.
   */
  birthdayWindowDays?: number;
}

export function buildUpcoming({
  events,
  athletes,
  today,
  perLane = 3,
  birthdayWindowDays = 45,
}: BuildUpcomingInput): UpcomingBuckets {
  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);

  const upcoming = events
    .filter(e => e.date && stillUpcoming(e, today))
    .map(e => ({ ...e, daysAway: Math.max(0, daysBetween(today, e.date)) }))
    .sort(byDate);

  const birthdays: UpcomingBirthday[] = [];
  for (const a of athletes) {
    // Inactive members are off the roster everywhere else in the app; a birthday
    // for someone who left would be the only place they still appear.
    if (!a.name || !a.birth_date || (a.status && a.status !== 'active')) continue;
    const date = nextBirthday(a.birth_date, today);
    if (!date) continue;
    const daysAway = daysBetween(today, date);
    if (daysAway > birthdayWindowDays) continue;
    birthdays.push({ athleteId: a.id, name: a.name, date, daysAway });
  }

  return {
    races: upcoming.filter(e => e.kind === 'race').slice(0, perLane),
    // Everything that isn't a race is a club event — camps, lectures, socials,
    // shoots, sponsor evenings, one-off workouts. Listing each kind as its own
    // lane would give five lanes that are empty most weeks.
    club: upcoming.filter(e => e.kind !== 'race').slice(0, perLane),
    birthdays: birthdays.sort(byDate).slice(0, perLane),
  };
}

/** True when there is nothing in any lane — the card renders nothing at all. */
export function isEmptyUpcoming(b: UpcomingBuckets): boolean {
  return b.races.length === 0 && b.club.length === 0 && b.birthdays.length === 0;
}
