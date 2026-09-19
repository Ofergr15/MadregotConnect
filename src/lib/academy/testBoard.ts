/**
 * The coach's side of the scheduled test: every open invitation, sorted by who is blocking.
 *
 * The trainee's card answers "what do I do about my test". This answers a different question,
 * and the difference is the whole design:
 *
 *   **Whose move is it?**
 *
 * ── WHY NOT A WEEK VIEW ─────────────────────────────────────────────────────────────────
 *
 * The obvious build is a calendar: everybody's test time, soonest first. It is the wrong
 * screen, because a chronological list mixes two things that feel identical and are opposites.
 * "Dor is testing Thursday" needs nothing from the coach. "Noa wrote back that she works
 * shifts" needs an answer, and it will sit quietly between two Thursdays that do not. The
 * academy loses candidates at exactly that seam: nobody refused, nobody was refused, a message
 * arrived and no reply went out.
 *
 * So the board is two lists. `onCoach` is the work; `onAthlete` is the week. A coach who reads
 * only the first list has done their job for the day, which is the only property of this screen
 * that matters.
 *
 * ── WHEN THE AUTOMATION RUNS OUT OF MOVES ───────────────────────────────────────────────
 *
 * An overdue test is NOT the coach's problem by default — the follow-up reminder exists so
 * that a forgotten Thursday gets asked about without a human doing it, and putting every
 * overdue trainee in the coach's list would make the list mostly things the app is already
 * handling, which is how a queue stops being read.
 *
 * But once the follow-up moment has passed and there is still no result, the app has said
 * everything it has to say. Twice. Silence after that is not forgetfulness any more, and it is
 * the last point at which a person is still reachable. So the board hands a trainee over to the
 * coach at exactly the moment the automation has nothing left to try — `followUpOwed` is the
 * same predicate the scheduler uses, so the hand-over cannot drift from the last reminder.
 *
 * ── NOTHING HERE READS THE CLOCK ────────────────────────────────────────────────────────
 *
 * `now` is a parameter, as in `testInvite.ts`: the board is a pure function of the rows and a
 * moment, so the preview and the audit are deterministic and a test cannot be flaky.
 */

import {
  daysPhrase,
  followUpOwed,
  inviteState,
  slotLabel,
  type InviteState,
  type TestInvitation,
} from './testInvite';

const DAY = 86_400_000;

/** How far ahead "this week" reaches, for the count the coach plans their own week around. */
export const WEEK_AHEAD_DAYS = 7;

/** An invitation as the coach sees it: the row, plus who it is about and when it moved. */
export interface BoardRow {
  invite: TestInvitation;
  /** The trainee's name. A board keyed on UUIDs answers nobody. */
  name: string;
  /** When the invitation was sent — the answer to "how long has this person been silent". */
  createdAt: string;
  /** When it last changed. For `other`, the moment the ball landed in the coach's court. */
  updatedAt: string;
  /**
   * When the trainee submitted a result for this invitation that nobody has approved yet.
   *
   * Null in every normal case, and the row's most important fact when it is not. An invitation
   * only becomes `done` at approval — `done` claims a measurement exists and this number has not
   * been looked at — so a submitted test leaves the invitation open, which without this field
   * puts the person on the board wearing `אין תוצאה`. That is the one label here that would be
   * flatly untrue: there is a result, it is sitting in the approval queue, and telling the coach
   * there is none is how a number waits a week.
   *
   * The route fills it from the same rule that settles the invitation
   * (`settleInvitation.ts` → `hold`), so "which submission answers this invitation" cannot drift
   * between the board and the write path.
   */
  submittedAt?: string | null;
}

export interface BoardEntry {
  row: BoardRow;
  state: InviteState;
  /**
   * The moment this entry is ordered by, in epoch ms.
   *
   * In `onAthlete` it is the test itself, so the list runs chronologically and overdue tests
   * come out above today's and today's above next week's with no priority table to maintain.
   * In `onCoach` it is `waitingSince`, ascending, so the longest-ignored person is at the top.
   */
  at: number;
  /**
   * When this entry started waiting on somebody, in epoch ms, or null if it is not waiting.
   *
   * Which moment that is depends on the state, and each is the moment a person would name:
   * the trainee's message arriving, the last offered time going by, the follow-up going out
   * unanswered, or the invitation being sent.
   */
  waitingSince: number | null;
  /** Israel CALENDAR days since `waitingSince` — 0 means today, 1 means yesterday. */
  silentDays: number;
  /** True once the follow-up reminder has been and gone with no result. See the header. */
  handedOver: boolean;
}

export interface Board {
  /** Nothing moves until the coach does something. Read this list and the day is done. */
  onCoach: BoardEntry[];
  /** Waiting on the trainee, chronologically: overdue, then today, then upcoming. */
  onAthlete: BoardEntry[];
  /** Confirmed tests inside the next `WEEK_AHEAD_DAYS`, today included. */
  testingThisWeek: number;
}

/**
 * The Israel calendar day of an instant, as a whole day number.
 *
 * The board counts CALENDAR days, not 24-hour blocks, because every phrase it prints is a
 * calendar word: `היום`, `אתמול`. Dividing an elapsed millisecond count by 86,400,000 is not the
 * same measure, and the gap between them is the commonest row on the screen — a test at 18:00
 * yesterday read by a coach at 09:00 is fifteen hours old, which floors to zero, so the board
 * said `הזמן עבר היום` about a test whose day is over. The `overdue` state exists precisely
 * because that day IS over, so the row contradicted its own chip.
 *
 * Read off the Israel wall clock, like `endOfIsraelDay` in `testInvite.ts`, so the boundary is
 * local midnight in both IST and IDT rather than midnight UTC — which in Israel falls at 02:00
 * or 03:00, i.e. inside the night the coach is asleep for and on the wrong side of `אתמול`.
 */
const ISRAEL_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function israelDayNumber(instant: number): number {
  const [y, m, d] = ISRAEL_DATE.format(new Date(instant)).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY);
}

/** The slot an entry is about, or null when no time was ever agreed. */
function slotOf(invite: TestInvitation): number | null {
  const confirmed = invite.confirmedSlot ? Date.parse(invite.confirmedSlot) : NaN;
  if (Number.isFinite(confirmed)) return confirmed;
  const offered = invite.proposedSlots
    .map(s => Date.parse(s))
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b);
  return offered.length ? offered[0] : null;
}

/** The latest offered time, which is the moment an unanswered invitation became `expired`. */
function lastOffered(invite: TestInvitation): number | null {
  const offered = invite.proposedSlots
    .map(s => Date.parse(s))
    .filter(t => Number.isFinite(t));
  return offered.length ? Math.max(...offered) : null;
}

/**
 * One row, placed.
 *
 * Exported for the tests, which is where the per-state reasoning is actually pinned down.
 */
export function boardEntry(row: BoardRow, now: string): BoardEntry | null {
  const t = Date.parse(now);
  if (!Number.isFinite(t)) return null;

  const state = inviteState(row.invite, now);
  // A finished or withdrawn invitation is not on anybody's board. The route only reads open
  // rows, so this is belt and braces — but a `done` row rendered under "waiting on the
  // trainee" would be the coach chasing somebody who already ran it.
  if (state === 'done' || state === 'cancelled') return null;

  // Nor is one whose result is already in the approval queue.
  //
  // It IS the coach's move — but it is not a SCHEDULING move, and this board is about
  // scheduling only (see the component header). The move is "check this number", the screen for
  // it is `PendingTests`, and that queue sits directly above this one on the tests tab, by
  // construction rather than by luck: `TestRegistry` takes the board as a prop precisely so that
  // order lives in one place. Showing the row here as well would put the same person in two
  // queues on one screen with two different answers, and the answer on this one — offer times —
  // is the wrong thing to do to somebody who has already run the test.
  if (row.submittedAt) return null;

  const handedOver = state === 'overdue' && followUpOwed(row.invite, now);
  const slot = slotOf(row.invite);
  const created = Date.parse(row.createdAt);
  const updated = Date.parse(row.updatedAt);

  // The moment somebody started waiting, per state. `null` for `confirmed` and `today`:
  // nobody is waiting on anybody, there is a test in the diary.
  let waitingSince: number | null = null;
  if (state === 'other_requested') {
    // When they wrote, not when they were invited. The invitation may be a fortnight old and
    // the message an hour old, and "waiting 14 days" next to a reply that just arrived is the
    // board accusing the coach of something they have not done yet.
    waitingSince = Number.isFinite(updated) ? updated : (Number.isFinite(created) ? created : null);
  } else if (state === 'expired') {
    waitingSince = lastOffered(row.invite);
  } else if (state === 'overdue') {
    waitingSince = slot;
  } else if (state === 'awaiting_answer') {
    waitingSince = Number.isFinite(created) ? created : null;
  }

  return {
    row,
    state,
    at: slot ?? (Number.isFinite(created) ? created : t),
    waitingSince,
    silentDays: waitingSince === null
      ? 0
      : Math.max(0, israelDayNumber(t) - israelDayNumber(waitingSince)),
    handedOver,
  };
}

/**
 * Whether this entry is the coach's move.
 *
 * `other_requested` and `expired` are unambiguous: the trainee has either asked for times or
 * been offered only times that have gone by, and in both cases the next thing that can possibly
 * happen is the coach offering some. `overdue` joins them only once the follow-up has fired —
 * see the header.
 */
/** Where an entry sits in the coach's list before age is considered. Lower is sooner. */
function coachRank(entry: BoardEntry): number {
  return entry.state === 'other_requested' ? 0 : 1;
}

function isCoachMove(entry: BoardEntry): boolean {
  if (entry.state === 'other_requested' || entry.state === 'expired') return true;
  return entry.state === 'overdue' && entry.handedOver;
}

export function buildBoard(rows: readonly BoardRow[], now: string): Board {
  const t = Date.parse(now);
  const entries = rows
    .map(row => boardEntry(row, now))
    .filter((e): e is BoardEntry => e !== null);

  const onCoach = entries.filter(isCoachMove);
  const onAthlete = entries.filter(e => !isCoachMove(e));

  // A MESSAGE OUTRANKS A SILENCE, and only then does age decide.
  //
  // Sorting this list by age alone was wrong, and wrong in the exact way the header warns
  // about: the first screenshot put the one trainee who had actually written something at the
  // BOTTOM, under two people who had said nothing, because their silences happened to be older.
  // A reply sitting beneath two non-answers is how a message goes unanswered — the failure this
  // whole screen exists to stop. Somebody who wrote is reachable, engaged and waiting on a
  // human; somebody whose offered times lapsed is waiting on an administrative act.
  onCoach.sort((a, b) =>
    coachRank(a) - coachRank(b) || (a.waitingSince ?? a.at) - (b.waitingSince ?? b.at));
  // Chronological, and that single rule produces the right order: overdue tests are in the
  // past so they sort above today's, and today's above the rest of the week's.
  onAthlete.sort((a, b) => a.at - b.at);

  const horizon = Number.isFinite(t) ? t + WEEK_AHEAD_DAYS * DAY : NaN;
  const testingThisWeek = entries.filter(e => {
    if (e.state !== 'confirmed' && e.state !== 'today') return false;
    // `today` counts even though its slot is behind us: it is still today's test, and a coach
    // asking "how many tests this week" is counting people, not future timestamps.
    return e.state === 'today' || (Number.isFinite(horizon) && e.at <= horizon);
  }).length;

  return { onCoach, onAthlete, testingThisWeek };
}

/**
 * What the coach has to do about this entry, in the imperative.
 *
 * A label, not a status. `ממתין` on four rows tells a coach nothing about which one to open;
 * every string here names the next action or the thing that is missing.
 */
export function coachActionLabel(entry: BoardEntry): string {
  switch (entry.state) {
    case 'other_requested': return 'ביקש זמן אחר';
    case 'expired': return 'הזמנים פגו';
    case 'overdue': return entry.handedOver ? 'גם אחרי התזכורת' : 'אין תוצאה';
    case 'awaiting_answer': return 'ממתין לתשובה';
    case 'today': return 'היום';
    // NO CHIP on a scheduled test, on purpose. `קבוע` beside a row whose own end column reads
    // `יום ב׳ / 07:00` is a word for what the time already says, and a chip on every row is a
    // chip that means nothing — the eye stops seeing them, including the two that matter.
    // A chip here marks something to note, so the settled case gets none.
    case 'confirmed': return '';
    default: return '';
  }
}

/**
 * The agreed time, split for the row's end column: `{ day: 'היום', time: '07:00' }`.
 *
 * Null when no time was ever agreed, which is every state in the coach's list except an overdue
 * one — you cannot put a time in the diary column for an invitation nobody answered.
 *
 * `היום` rather than the weekday name on the day itself. The first screenshot read
 * `הטסט היום` beside `יום ש׳ · 07:00`, which makes a coach stop and work out whether ש׳ is in
 * fact today — a calculation the screen was supposed to have done for them.
 */
export function entryTime(entry: BoardEntry): { day: string; time: string } | null {
  const slot = entry.row.invite.confirmedSlot;
  const label = slot ? slotLabel(slot) : null;
  if (!label) return null;
  // `slotLabel` is `יום ה׳ · 07:00`, built in one place so the hour is always Israel wall-clock.
  const [day, time] = label.split(' · ');
  if (!time) return null;
  return { day: entry.state === 'today' ? 'היום' : day, time };
}

/**
 * How long ago something happened, in days. `0` → `היום`, `1` → `אתמול`, `2` → `לפני יומיים`.
 *
 * FOUR-way, not the three-way `daysPhrase` handles, and the extra case is the one a machine
 * writes wrong: `לפני יום` is not how anybody says "a day ago" — the word for that is `אתמול`.
 * So this cannot be `לפני ${daysPhrase(n)}`, which would be correct at 0, wrong at 1, correct
 * at 2 by accident (the dual carries no numeral) and correct from 3 up. One wrong case in four,
 * on the most common value on the board, is exactly the sort of thing that never gets noticed.
 */
export function agoPhrase(days: number): string {
  const n = Math.max(0, Math.round(days));
  if (n === 0) return 'היום';
  if (n === 1) return 'אתמול';
  return `לפני ${daysPhrase(n)}`;
}

/**
 * The second line of a row: WHEN this started, never a repeat of the chip above it.
 *
 * Two rules, both learned off the first screenshots.
 *
 * A whole sentence rather than a shared `label · duration` template: the template printed
 * `ממתין לתשובה · יומיים`, where the two days could as easily have been two days from now as
 * two days ago — and on a board whose entire purpose is to distinguish kinds of silence, an
 * ambiguous duration is the one thing it must not print.
 *
 * And it never says what the chip says. `ביקש זמן אחר` in the chip above `ביקש זמן אחר היום`
 * spent a whole line to add one word, and a row that repeats itself teaches the coach that the
 * second line is decoration. Every state here contributes the one thing the chip cannot: how
 * long this has been true.
 */
export function detailLine(entry: BoardEntry): string {
  const when = entry.waitingSince === null ? null : agoPhrase(entry.silentDays);

  switch (entry.state) {
    case 'awaiting_answer':
      return `ההזמנה נשלחה ${when}`;
    case 'other_requested':
      return `הבקשה הגיעה ${when}`;
    case 'expired':
      // The LAST offered time, not the first — that is the moment the invitation ran out.
      return `הזמן האחרון שהוצע עבר ${when}`;
    case 'overdue':
      // Says how long ago, which the end column's `יום ד׳ · 07:00` does not: a coach should not
      // have to count days off a weekday name to see that this one has been silent since Sunday.
      return `הזמן עבר ${when}`;
    // Nothing to add. The time is in the row's end column and nobody is waiting on anybody.
    case 'today':
    case 'confirmed':
      return '';
    default:
      return '';
  }
}
