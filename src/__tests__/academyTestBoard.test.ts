import { describe, expect, it } from 'vitest';
import {
  agoPhrase,
  boardEntry,
  buildBoard,
  coachActionLabel,
  detailLine,
  entryTime,
  type BoardRow,
} from '@/lib/academy/testBoard';
import type { TestInvitation } from '@/lib/academy/testInvite';

/**
 * The coach's invitation board.
 *
 * `academyTestInvite.test.ts` proves which state a row is in. This file is about the one
 * question this module adds: **whose move is it** — because a board that answers it wrongly is
 * worse than no board. A trainee's message filed under "waiting on the trainee" is a candidate
 * lost in a screen built to stop exactly that.
 */

const DAY = 86_400_000;
const NOW = '2026-09-17T09:00:00+03:00';
const T = Date.parse(NOW);

/** An instant `days` from `NOW`. Negative is the past. */
const at = (days: number) => new Date(T + days * DAY).toISOString();

function row(
  over: Partial<TestInvitation> & {
    name?: string; createdAt?: string; updatedAt?: string; submittedAt?: string | null;
  } = {},
): BoardRow {
  const { name, createdAt, updatedAt, submittedAt, ...invite } = over;
  return {
    name: name ?? 'Dor Alon',
    createdAt: createdAt ?? at(-3),
    updatedAt: updatedAt ?? at(-3),
    submittedAt: submittedAt ?? null,
    invite: {
      id: 'inv-1',
      athleteId: 'a1',
      protocol: '30min',
      proposedSlots: [at(2), at(3)],
      status: 'proposed',
      ...invite,
    },
  };
}

const entry = (r: BoardRow) => boardEntry(r, NOW)!;

describe('whose move it is', () => {
  it('puts a request for another time on the coach', () => {
    const board = buildBoard([row({ status: 'other', requestedNote: 'עובד במשמרות' })], NOW);
    expect(board.onCoach).toHaveLength(1);
    expect(board.onAthlete).toHaveLength(0);
    expect(board.onCoach[0].state).toBe('other_requested');
  });

  it('puts an invitation whose offered times all went by on the coach', () => {
    // Nobody refused anything. The only thing that can happen next is new times.
    const board = buildBoard([row({ proposedSlots: [at(-5), at(-2)] })], NOW);
    expect(board.onCoach.map(e => e.state)).toEqual(['expired']);
  });

  it('leaves an unanswered invitation with a future time on the trainee', () => {
    const board = buildBoard([row()], NOW);
    expect(board.onCoach).toHaveLength(0);
    expect(board.onAthlete.map(e => e.state)).toEqual(['awaiting_answer']);
  });

  it('leaves a freshly overdue test on the trainee, because the app is still working on it', () => {
    // Yesterday's test, no result. The follow-up has not fired yet, so this is not the coach's
    // problem — a board full of things the app is already handling stops being read.
    const board = buildBoard([row({ status: 'confirmed', confirmedSlot: at(-1) })], NOW);
    expect(board.onCoach).toHaveLength(0);
    expect(board.onAthlete[0].handedOver).toBe(false);
  });

  it('HANDS OVER an overdue test once the follow-up has been and gone', () => {
    // FOLLOW_UP_DAYS_AFTER is 2, so a slot three days ago has had both reminders. The app has
    // said everything it has to say, twice, and this is the last moment the person is reachable.
    const board = buildBoard([row({ status: 'confirmed', confirmedSlot: at(-3) })], NOW);
    expect(board.onCoach).toHaveLength(1);
    expect(board.onCoach[0].handedOver).toBe(true);
    expect(coachActionLabel(board.onCoach[0])).toMatch(/תזכורת/);
  });

  it('never hands over a test that produced a result', () => {
    // The whole point of `followUpOwed`. A trainee who ran it is not chased for it.
    const board = buildBoard([row({ status: 'confirmed', confirmedSlot: at(-3), testId: 't1' })], NOW);
    expect(board.onCoach).toHaveLength(0);
    expect(board.onAthlete[0].handedOver).toBe(false);
  });

  it('keeps a confirmed test and today’s test off the coach’s list entirely', () => {
    const board = buildBoard([
      row({ id: 'a', status: 'confirmed', confirmedSlot: at(2) }),
      // 07:00 today, and it is 09:00: still today's test, not a failure.
      row({ id: 'b', status: 'confirmed', confirmedSlot: '2026-09-17T07:00:00+03:00' }),
    ], NOW);
    expect(board.onCoach).toHaveLength(0);
    expect(board.onAthlete.map(e => e.state)).toEqual(['today', 'confirmed']);
  });

  it('drops finished and withdrawn invitations from both lists', () => {
    const board = buildBoard([
      row({ id: 'a', status: 'done', testId: 't1' }),
      row({ id: 'b', status: 'cancelled' }),
    ], NOW);
    expect(board.onCoach).toHaveLength(0);
    expect(board.onAthlete).toHaveLength(0);
  });
});

describe('the order', () => {
  it('sorts the coach’s list longest-ignored first, among entries of the same kind', () => {
    const board = buildBoard([
      row({ id: 'new', athleteId: 'a1', status: 'other', updatedAt: at(-0.2) }),
      row({ id: 'old', athleteId: 'a2', status: 'other', updatedAt: at(-9) }),
    ], NOW);
    expect(board.onCoach.map(e => e.row.invite.id)).toEqual(['old', 'new']);
  });

  it('puts A MESSAGE above A SILENCE even when the silence is older', () => {
    // Age alone was the first rule and it was wrong: it put the one trainee who had actually
    // written something at the BOTTOM, under two people who had said nothing, because their
    // silences happened to be older. A reply sitting beneath two non-answers is how a message
    // goes unanswered — the failure this screen exists to stop.
    const board = buildBoard([
      row({ id: 'lapsed', athleteId: 'a1', proposedSlots: [at(-6)] }),
      row({ id: 'overdue', athleteId: 'a2', status: 'confirmed', confirmedSlot: at(-8) }),
      row({ id: 'wrote', athleteId: 'a3', status: 'other', updatedAt: at(-0.5) }),
    ], NOW);
    expect(board.onCoach[0].row.invite.id).toBe('wrote');
    // And the two silences still order by age between themselves.
    expect(board.onCoach.map(e => e.row.invite.id)).toEqual(['wrote', 'overdue', 'lapsed']);
  });

  it('sorts the trainee’s list chronologically, which puts overdue above today above next week', () => {
    // One rule, and it produces the priority order without a priority table to keep in step.
    const board = buildBoard([
      row({ id: 'later', athleteId: 'a1', status: 'confirmed', confirmedSlot: at(4) }),
      row({ id: 'overdue', athleteId: 'a2', status: 'confirmed', confirmedSlot: at(-1) }),
      row({ id: 'today', athleteId: 'a3', status: 'confirmed', confirmedSlot: '2026-09-17T07:00:00+03:00' }),
      row({ id: 'soon', athleteId: 'a4', status: 'confirmed', confirmedSlot: at(1) }),
    ], NOW);
    expect(board.onAthlete.map(e => e.row.invite.id)).toEqual(['overdue', 'today', 'soon', 'later']);
  });
});

describe('how long somebody has been waiting', () => {
  it('counts an unanswered invitation from when it was sent', () => {
    expect(entry(row({ createdAt: at(-4) })).silentDays).toBe(4);
  });

  it('counts a request for another time from WHEN THEY WROTE, not when they were invited', () => {
    // A fortnight-old invitation answered an hour ago is not a coach who has ignored somebody
    // for a fortnight, and a board that says so is accusing them of something untrue.
    const e = entry(row({ status: 'other', createdAt: at(-14), updatedAt: at(-0.1) }));
    expect(e.silentDays).toBe(0);
  });

  it('counts an expired invitation from the LAST offered time, not the first', () => {
    // The invitation is not dead while one of its times is still ahead, so the clock starts
    // when the final one goes by.
    const e = entry(row({ proposedSlots: [at(-8), at(-2)] }));
    expect(e.state).toBe('expired');
    expect(e.silentDays).toBe(2);
  });

  it('counts CALENDAR days, so last evening is אתמול and not היום', () => {
    // 18:00 yesterday read at 09:00 today is fifteen hours, which floors to zero — and the board
    // then printed `הזמן עבר היום` about a test whose day is over, contradicting the very state
    // (`overdue`) that only exists because the day ended. Every phrase here is a calendar word,
    // so the measure has to be calendar days on the Israel clock.
    const e = entry(row({ status: 'confirmed', confirmedSlot: '2026-09-16T18:00:00+03:00' }));
    expect(e.state).toBe('overdue');
    expect(e.silentDays).toBe(1);
    expect(detailLine(e)).toBe('הזמן עבר אתמול');
  });

  it('counts the small hours of this morning as היום', () => {
    // The other side of the same boundary: 01:00 today is eight hours ago and still today, and
    // a UTC-midnight day boundary would have called it yesterday in Israel.
    expect(entry(row({ createdAt: '2026-09-17T01:00:00+03:00' })).silentDays).toBe(0);
  });

  it('reports nobody waiting on a scheduled test', () => {
    const e = entry(row({ status: 'confirmed', confirmedSlot: at(2) }));
    expect(e.waitingSince).toBeNull();
    expect(e.silentDays).toBe(0);
  });
});

describe('testing this week', () => {
  it('counts confirmed tests inside the week, today included', () => {
    const board = buildBoard([
      row({ id: 'a', athleteId: 'a1', status: 'confirmed', confirmedSlot: '2026-09-17T07:00:00+03:00' }),
      row({ id: 'b', athleteId: 'a2', status: 'confirmed', confirmedSlot: at(3) }),
      row({ id: 'c', athleteId: 'a3', status: 'confirmed', confirmedSlot: at(20) }),
      // Unanswered and overdue are not tests in the diary, whatever their dates say.
      row({ id: 'd', athleteId: 'a4' }),
      row({ id: 'e', athleteId: 'a5', status: 'confirmed', confirmedSlot: at(-3) }),
    ], NOW);
    expect(board.testingThisWeek).toBe(2);
  });
});

describe('saying how long ago', () => {
  it('agrees with itself FOUR ways, because one day ago is not "לפני יום"', () => {
    // `לפני ${daysPhrase(n)}` is correct at 0, WRONG at 1, correct at 2 by accident and correct
    // from 3 up. One wrong case in four, on the commonest value on the board.
    expect(agoPhrase(0)).toBe('היום');
    expect(agoPhrase(1)).toBe('אתמול');
    expect(agoPhrase(2)).toBe('לפני יומיים');
    expect(agoPhrase(5)).toBe('לפני 5 ימים');
    // Never a numeral beside the dual: `לפני 2 יומיים` reads as "two two-days ago".
    expect(agoPhrase(2)).not.toMatch(/\d/);
  });

  it('treats a negative or fractional count as today rather than printing nonsense', () => {
    expect(agoPhrase(-3)).toBe('היום');
    expect(agoPhrase(0.4)).toBe('היום');
  });
});

describe('robustness', () => {
  it('returns null rather than throwing on an unreadable clock', () => {
    expect(boardEntry(row(), 'not a date')).toBeNull();
    expect(buildBoard([row()], 'not a date')).toMatchObject({ onCoach: [], onAthlete: [] });
  });

  it('places an invitation with no readable time at all without crashing', () => {
    // `inviteState` treats this as expired — no future slot — so it is the coach's move, which
    // is right: a row nobody can act on needs new times.
    const board = buildBoard([row({ proposedSlots: ['nonsense'] })], NOW);
    expect(board.onCoach.map(e => e.state)).toEqual(['expired']);
    expect(board.onCoach[0].silentDays).toBe(0);
  });

  it('never prints a bare duration that could be read as forwards or backwards', () => {
    // The shared `label · 2 days` template was ambiguous on the one screen whose entire job is
    // distinguishing kinds of silence.
    const sent = detailLine(entry(row({ createdAt: at(-4) })));
    expect(sent).toBe('ההזמנה נשלחה לפני 4 ימים');
    expect(detailLine(entry(row({ status: 'other', updatedAt: at(-2) })))).toBe('הבקשה הגיעה לפני יומיים');
    expect(detailLine(entry(row({ proposedSlots: [at(-1.2)] })))).toBe('הזמן האחרון שהוצע עבר אתמול');
  });

  it('never repeats the chip on the line under it', () => {
    // `ביקש זמן אחר` above `ביקש זמן אחר היום` spent a whole line to add one word, and a row
    // that repeats itself teaches the coach that the second line is decoration.
    for (const r of [
      row({ status: 'other', updatedAt: at(-2) }),
      row({ proposedSlots: [at(-2)] }),
      row({ status: 'confirmed', confirmedSlot: at(-1) }),
      row({ status: 'confirmed', confirmedSlot: at(-4) }),
      row(),
    ]) {
      const e = entry(r);
      const chip = coachActionLabel(e);
      expect(chip).not.toBe('');
      expect(detailLine(e)).not.toContain(chip);
    }
  });

  it('gives a scheduled test NO chip, because its own time column already says so', () => {
    // A chip on every row is a chip that means nothing — the eye stops seeing them, including
    // the two that matter.
    expect(coachActionLabel(entry(row({ status: 'confirmed', confirmedSlot: at(2) })))).toBe('');
    expect(detailLine(entry(row({ status: 'confirmed', confirmedSlot: at(2) })))).toBe('');
  });

  it('says היום instead of the weekday name on the day itself', () => {
    // `הטסט היום` beside `יום ש׳ · 07:00` makes a coach work out whether ש׳ is in fact today —
    // a calculation the screen was supposed to have done for them.
    expect(entryTime(entry(row({ status: 'confirmed', confirmedSlot: '2026-09-17T07:00:00+03:00' }))))
      .toEqual({ day: 'היום', time: '07:00' });
    expect(entryTime(entry(row({ status: 'confirmed', confirmedSlot: at(2) })))?.day).toMatch(/^יום /);
  });

  it('has no time column for an invitation nobody answered', () => {
    expect(entryTime(entry(row()))).toBeNull();
    expect(entryTime(entry(row({ status: 'other' })))).toBeNull();
    expect(entryTime(entry(row({ proposedSlots: [at(-2)] })))).toBeNull();
  });
});

describe('a result that is waiting for approval', () => {
  it('leaves the board entirely rather than claiming there is no result', () => {
    // The coach's move here is "check this number", and the screen for that is the approval
    // queue directly above this board. Showing the row here as well would put the same person
    // in two queues with two different answers — and this one's answer, offer new times, is
    // the wrong thing to do to somebody who has already run the test.
    const submitted = row({
      status: 'confirmed', confirmedSlot: at(-4), submittedAt: at(-4),
    });
    const board = buildBoard([submitted], NOW);
    expect(board.onCoach).toEqual([]);
    expect(board.onAthlete).toEqual([]);
    expect(board.testingThisWeek).toBe(0);
  });

  it('still shows a test whose result has NOT been submitted', () => {
    // The same row without the submission: four days past the slot, so the follow-up has been
    // and gone and this genuinely is the coach's to chase.
    const board = buildBoard([row({ status: 'confirmed', confirmedSlot: at(-4) })], NOW);
    expect(board.onCoach.map(e => e.state)).toEqual(['overdue']);
  });
});
