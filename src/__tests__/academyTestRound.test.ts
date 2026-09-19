import { describe, expect, it } from 'vitest';
import { buildRound, roundSummary, type RoundCandidate } from '@/lib/academy/testRound';

/**
 * The test round — `שבץ סבב`.
 *
 * Two properties carry the whole feature, and both are about who the round LEAVES ALONE:
 *
 *  - Somebody who tested recently is not invited. A threshold test three weeks after the last
 *    one measures the week rather than the block, and spends a trainee's willingness to turn up.
 *  - Somebody already invited is not re-invited. A re-offer would overwrite a Tuesday they have
 *    already confirmed, and the reminders move with `confirmed_slot`.
 *
 * The second is also what makes a half-failed round safe to re-run, which is the only recovery
 * story N independent writes can have.
 */

function candidate(over: Partial<RoundCandidate> = {}): RoundCandidate {
  return { athleteId: 'a1', name: 'Dor Alon', ageDays: 200, overdue: true, ...over };
}

describe('who a round invites', () => {
  it('takes the overdue and leaves the rest', () => {
    const round = buildRound([
      candidate({ athleteId: 'a1', name: 'Dor', ageDays: 200, overdue: true }),
      candidate({ athleteId: 'a2', name: 'Noa', ageDays: 20, overdue: false }),
    ], new Set());
    expect(round.members.map(m => m.athleteId)).toEqual(['a1']);
    expect(round.skipped).toEqual([{ athleteId: 'a2', name: 'Noa', reason: 'tested_recently' }]);
  });

  it('puts the never-tested above everybody, however old the others are', () => {
    // There is no threshold to have gone stale, which is worse than a stale one and not better.
    const round = buildRound([
      candidate({ athleteId: 'old', name: 'Avi', ageDays: 400, overdue: true }),
      candidate({ athleteId: 'never', name: 'Yael', ageDays: null, overdue: true }),
    ], new Set());
    expect(round.members.map(m => m.athleteId)).toEqual(['never', 'old']);
    expect(round.members[0].reason).toBe('never_tested');
    expect(round.members[1].reason).toBe('stale');
  });

  it('orders the stale by how long it has been', () => {
    const round = buildRound([
      candidate({ athleteId: 'a', name: 'A', ageDays: 130 }),
      candidate({ athleteId: 'b', name: 'B', ageDays: 300 }),
      candidate({ athleteId: 'c', name: 'C', ageDays: 200 }),
    ], new Set());
    expect(round.members.map(m => m.athleteId)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie by name, so the same roster gives the same round twice', () => {
    const round = buildRound([
      candidate({ athleteId: 'b', name: 'בני', ageDays: 200 }),
      candidate({ athleteId: 'a', name: 'אורי', ageDays: 200 }),
    ], new Set());
    expect(round.members.map(m => m.athleteId)).toEqual(['a', 'b']);
  });

  it('carries the age, so the screen can say why each person is in the round', () => {
    const round = buildRound([candidate({ ageDays: 187 })], new Set());
    expect(round.members[0]).toMatchObject({ reason: 'stale', ageDays: 187 });
  });
});

describe('who a round must not touch', () => {
  it('skips an athlete who already has an open invitation', () => {
    // A re-offer would overwrite a time they may already have confirmed, and both reminders are
    // computed from that time.
    const round = buildRound([candidate({ athleteId: 'a1', name: 'Dor' })], new Set(['a1']));
    expect(round.members).toEqual([]);
    expect(round.skipped).toEqual([{ athleteId: 'a1', name: 'Dor', reason: 'already_invited' }]);
  });

  it('says "already invited" and not "tested recently" about an overdue person who was asked', () => {
    // The more specific fact wins: they have been asked, and reporting a fresh test would be
    // false twice over.
    const round = buildRound([candidate({ athleteId: 'a1', overdue: true, ageDays: 300 })], new Set(['a1']));
    expect(round.skipped[0].reason).toBe('already_invited');
  });

  it('is empty rather than wrong when everybody is current', () => {
    const round = buildRound([
      candidate({ athleteId: 'a1', overdue: false, ageDays: 10 }),
      candidate({ athleteId: 'a2', overdue: false, ageDays: 40 }),
    ], new Set());
    expect(round.members).toEqual([]);
    expect(round.skipped).toHaveLength(2);
  });

  it('is empty for an empty roster', () => {
    expect(buildRound([], new Set())).toEqual({ members: [], skipped: [] });
  });

  it('can be run again after a half-failure, and covers only what is left', () => {
    // The recovery story for N independent writes: three of four invitations landed, so those
    // three now have open invitations and the re-run is exactly the fourth person.
    const roster = [
      candidate({ athleteId: 'a1', name: 'A', ageDays: 300 }),
      candidate({ athleteId: 'a2', name: 'B', ageDays: 290 }),
      candidate({ athleteId: 'a3', name: 'C', ageDays: 280 }),
      candidate({ athleteId: 'a4', name: 'D', ageDays: 270 }),
    ];
    expect(buildRound(roster, new Set()).members).toHaveLength(4);
    const again = buildRound(roster, new Set(['a1', 'a2', 'a3']));
    expect(again.members.map(m => m.athleteId)).toEqual(['a4']);
  });
});

describe('what the coach is asked to confirm', () => {
  it('names the count and the number of times, because that is what N people receive', () => {
    const round = buildRound([
      candidate({ athleteId: 'a1', name: 'A' }),
      candidate({ athleteId: 'a2', name: 'B' }),
    ], new Set());
    expect(roundSummary(round, 3)).toBe('2 מתאמנים יקבלו הזמנה עם 3 זמנים לבחירה.');
  });

  it('agrees the verb with the count, for one person and one time', () => {
    const round = buildRound([candidate()], new Set());
    expect(roundSummary(round, 1)).toBe('מתאמן אחד יקבל הזמנה עם זמן אחד לבחירה.');
  });

  it('explains an empty round instead of offering a button that does nothing', () => {
    expect(roundSummary({ members: [], skipped: [] }, 3))
      .toBe('אין למי לשבץ סבב — לכל המתאמנים יש טסט עדכני או הזמנה פתוחה.');
  });
});
