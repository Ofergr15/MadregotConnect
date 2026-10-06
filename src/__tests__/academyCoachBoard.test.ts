import { describe, expect, it } from 'vitest';
import {
  buildCoachCards,
  coachCapacityOf,
  coachSummaryParts,
  DEFAULT_COACH_CAPACITY,
  unpairedTrainees,
} from '@/lib/academy/coach-board';
import type { AcademyMember } from '@/lib/academy/members';

const m = (athleteId: string, coach: string | null, o: Partial<AcademyMember> = {}): AcademyMember => ({
  athleteId, name: athleteId, academyCoachId: coach, approved: true, status: 'active',
  plannedCount: 4, completedCount: 3, attention: [], avatarUrl: null, ...o,
} as unknown as AcademyMember);

describe('coachCapacityOf', () => {
  it('reads coachCapacity, and defaults to 8 when absent or nonsense', () => {
    expect(coachCapacityOf({ coachCapacity: 5 })).toBe(5);
    expect(DEFAULT_COACH_CAPACITY).toBe(8);
    for (const bad of [undefined, null, {}, { coachCapacity: 0 }, { coachCapacity: -2 }, { coachCapacity: 2.5 }, { coachCapacity: '6' }]) {
      expect(coachCapacityOf(bad)).toBe(8);
    }
  });
});

describe('buildCoachCards', () => {
  const coaches = [
    { id: 'dana', name: 'Dana', avatarUrl: null, trainees: 0 },
    { id: 'avi', name: 'Avi', avatarUrl: null, trainees: 0 },
  ];
  const members = [
    m('t1', 'dana', { attention: ['inactive'] }),
    m('t2', 'dana', { attention: ['low_adherence'], completedCount: 1 }),
    m('t3', 'dana'),
    m('t4', null),
  ];

  it('fills the bar: fine trainees, then behind in orange, then free places', () => {
    const [dana, avi] = buildCoachCards(coaches, members, 8);
    expect(dana.slots).toEqual(['filled', 'behind', 'behind', 'free', 'free', 'free', 'free', 'free']);
    expect(dana).toMatchObject({ behind: 2, notRunning: 1, free: 5 });
    expect(dana.completionRate).toBeCloseTo(7 / 12);
    expect(avi).toMatchObject({ free: 8, completionRate: null });
    expect(avi.slots.every(s => s === 'free')).toBe(true);
  });

  it('an over-full coach shows every trainee and has 0 free, never negative', () => {
    const many = Array.from({ length: 4 }, (_, i) => m(`x${i}`, 'dana'));
    const [dana] = buildCoachCards(coaches.slice(0, 1), many, 3);
    expect(dana.slots).toHaveLength(4);
    expect(dana.free).toBe(0);
  });
});

describe('unpairedTrainees', () => {
  it('is approved trainees with no coach', () => {
    const list = unpairedTrainees([m('a', null), m('b', 'dana'), m('c', null, { approved: false }), m('d', null, { status: 'removed' })]);
    expect(list.map(x => x.athleteId)).toEqual(['a']);
  });
});

describe('coachSummaryParts', () => {
  it('numbers apart from words, so the view can isolate them', () => {
    const [card] = buildCoachCards([{ id: 'dana', name: 'Dana', avatarUrl: null, trainees: 0 }], [
      m('t1', 'dana', { attention: ['no_runs'] }), m('t2', 'dana'),
    ], 8);
    expect(coachSummaryParts(card)).toEqual([
      { value: '2', label: 'מתאמנים' },
      { value: '75%', label: 'בתוכנית' },
      { value: '1', label: 'לא רץ' },
    ]);
    expect(coachSummaryParts({ trainees: [], completionRate: null, notRunning: 0 })).toEqual([{ value: null, label: 'עוד אין מתאמנים' }]);
  });
});

describe('suggestedCoachId', () => {
  const card = (id: string, free: number, trainees = 0) => ({ id, name: id, free, trainees: Array(trainees).fill(null) as never[] });
  it('offers the freest coach only, and nobody when nobody is unpaired or nobody has room', async () => {
    const { suggestedCoachId } = await import('@/lib/academy/coach-board');
    expect(suggestedCoachId([card('dana', 2, 6), card('avi', 8, 0), card('guy', 2, 6)], 2)).toBe('avi');
    expect(suggestedCoachId([card('dana', 2, 6), card('avi', 8, 0)], 0)).toBeNull();
    expect(suggestedCoachId([card('dana', 0, 8)], 3)).toBeNull();
    expect(suggestedCoachId([card('b', 3, 5), card('a', 3, 5)], 1)).toBe('a');
  });
});
