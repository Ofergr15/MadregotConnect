/**
 * Building the times a coach offers for a test.
 *
 * The other half of the invitation, and the half nobody could do from a screen: until now the
 * only way to create one was a hand-run POST, which meant the feature had a reader and no
 * author. What makes it worth its own module is that every value it produces is a WRITE — a
 * `proposed_slots` array a trainee will be asked to pick from, and the array the reminders are
 * later computed off. An hour out is a push notification at the wrong time and a test offered
 * for a moment that has already gone.
 *
 * ── THE SHAPE OF THE OFFER IS THE REAL WORK ──────────────────────────────────────────────
 *
 * A coach does not pick three arbitrary date-times. They pick ONE hour — the hour their
 * trainees test at — and then two or three days that suit the person. That is why this builds a
 * cross-product of `days × one time` rather than offering three independent pickers: three
 * date-time fields is three chances to fat-finger a month on a phone, and it models a choice
 * nobody makes.
 *
 * ── WALL CLOCK, NOT `+03:00` ─────────────────────────────────────────────────────────────
 *
 * `07:00` means seven in the morning in Israel, which is `+03:00` in summer and `+02:00` in
 * winter. Every preview in this repo hardcodes `+03:00` and is right to — a fixture is not a
 * write. Here that shortcut would silently offer a 06:00 test for half the year, so the offset
 * is read from the zone at the instant in question and the answer is settled twice, because the
 * first reading uses the wrong side of a DST boundary on the two days a year one exists.
 */

import { slotDayLabel, slotLabel } from './testInvite';

/**
 * How far ahead a coach may offer. Two weeks: far enough for "after my exams", short enough
 * that the list stays a row of chips. GUESSED — Ofer's actual habit may be a week.
 */
export const OFFER_DAYS_AHEAD = 14;

/**
 * How many times may be offered at once. Three, matching the trainee's chip row: a fourth
 * makes the offer a decision rather than an appointment, and the screen it lands on has to fit
 * every one of them at 44px with the confirm button still above the fold.
 */
export const MAX_OFFERED_SLOTS = 3;

/**
 * The hours a threshold test actually gets run at — before work or after it. GUESSED, and the
 * one list here worth Ofer's correction: a custom time is always available, so a wrong guess
 * costs two extra taps rather than making anything impossible.
 */
export const COMMON_HOURS = ['06:00', '07:00', '18:00', '19:00'];

const ISRAEL = 'Asia/Jerusalem';

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** How far Israel's wall clock is ahead of UTC at a given instant, in ms. */
function israelOffsetMs(at: number): number {
  const p = Object.fromEntries(PARTS.formatToParts(new Date(at)).map(x => [x.type, x.value]));
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    // `hour12: false` renders midnight as `24` in some ICU versions.
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asIfUtc - at;
}

/**
 * `('2026-01-14', '07:00')` → the instant that is 07:00 in Israel on that date.
 *
 * Read twice on purpose. The first pass asks "what is the offset at the moment that would be
 * 07:00 if Israel were UTC", which is a few hours off the real one and lands on the wrong side
 * of the clock change on the two days a year that matters; the second asks the same question at
 * the answer, which is inside the correct offset. Returns null rather than a guess for anything
 * unparseable: a slot nobody meant is worse than a form that refuses.
 */
export function israelInstant(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const naive = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(naive)) return null;
  const once = naive - israelOffsetMs(naive);
  const twice = naive - israelOffsetMs(once);
  return new Date(twice).toISOString();
}

export interface DayOption {
  /** `2026-09-21`, the value that goes back into `israelInstant`. */
  day: string;
  /** `יום א׳` — the way a coach and a trainee both name a day. */
  label: string;
  /** `21.09`, so two Tuesdays three weeks apart are not the same day. */
  date: string;
  /** `21` — the number on a calendar cell. */
  dayOfMonth: string;
  /** 0 = Sunday, which is the first column of an Israeli week. */
  weekday: number;
}

const DAY = 86_400_000;

const ISRAEL_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The days a test may be offered for, starting TOMORROW.
 *
 * Today is left out deliberately, and not because the form could not express it: a maximal
 * 30-minute effort offered with a few hours' notice is either already impossible (most of the
 * offerable hours are behind us by the time a coach is at this screen) or an ask nobody should
 * make, and the 12-hour reminder computed off the slot could never fire for it. The coach who
 * genuinely arranges a test for this afternoon does it on the phone and records the agreed time
 * as a confirm, which the route allows staff precisely for that.
 */
export function dayOptions(now: string, daysAhead: number = OFFER_DAYS_AHEAD): DayOption[] {
  const t = Date.parse(now);
  if (!Number.isFinite(t)) return [];
  // Noon today in Israel, so that adding whole days can neither skip nor repeat a date across a
  // clock change — 00:00 + 24h lands on 23:00 the same day when the clocks go back.
  const noon = israelInstant(ISRAEL_DAY.format(new Date(t)), '12:00');
  if (!noon) return [];
  const base = Date.parse(noon);
  const out: DayOption[] = [];
  for (let i = 1; i <= daysAhead; i++) {
    const day = ISRAEL_DAY.format(new Date(base + i * DAY));
    const iso = israelInstant(day, '12:00');
    if (!iso) continue;
    const [, month, dayOfMonth] = day.split('-');
    out.push({
      day,
      label: slotDayLabel(iso) ?? '',
      date: `${dayOfMonth}.${month}`,
      dayOfMonth: String(Number(dayOfMonth)),
      // `getUTCDay` and not `getDay`: the instant is NOON in Israel, so its UTC date is the same
      // calendar date, while the local `getDay` would be the reviewer's zone and can be a day out.
      weekday: new Date(iso).getUTCDay(),
    });
  }
  return out;
}

/**
 * The offer, as the array that will be written.
 *
 * Sorted ascending because the trainee's screen treats the first surviving slot as the one being
 * asked for; de-duplicated because the same day cannot be offered twice; and anything already in
 * the past is dropped rather than refused — a coach building tomorrow's offer at one in the
 * morning should not be told off because 06:00 today is behind them.
 */
export function buildOffer(days: readonly string[], time: string, now: string): string[] {
  const t = Date.parse(now);
  if (!Number.isFinite(t)) return [];
  const seen = new Set<string>();
  const slots: string[] = [];
  for (const day of days) {
    const iso = israelInstant(day, time);
    if (!iso || seen.has(iso)) continue;
    if (Date.parse(iso) <= t) continue;
    seen.add(iso);
    slots.push(iso);
  }
  return slots.sort((a, b) => Date.parse(a) - Date.parse(b)).slice(0, MAX_OFFERED_SLOTS);
}

/** `יום ג׳ · 07:00 · יום ה׳ · 07:00`, for the confirm line above the send button. */
export function offerSummary(slots: readonly string[]): string {
  return slots.map(s => slotLabel(s)).filter((s): s is string => !!s).join(' · ');
}
