import { describe, expect, it } from 'vitest';
import { duePolls, pendingOf, removePoll, upsertPoll, validPoll, type PlannedPoll } from '@/lib/week-setup/planned-polls';

const base = (id: string, sendAt: string, extra: Partial<PlannedPoll> = {}): PlannedPoll => ({
  id, question: 'מגיעים למרוץ העגור?', options: ['רץ/ה', 'בא/ה לעודד', 'לא הפעם'], closesAt: null, multi: false, anonymous: false,
  audienceType: 'all', audienceId: null, sendAt, feed: true, by: 'Ofer', byId: 'o1', email: 'o@x', createdAt: '2026-10-24T19:00:00Z', ...extra,
});

describe('the week\'s planned polls (week-setup v2, stage 3)', () => {
  it('kept in the order they go out; a change replaces by id; old weeks dropped', () => {
    let s = upsertPoll({ '2026-09-06': [base('old', '2026-09-07T05:00:00Z')] }, '2026-10-25', base('b', '2026-10-29T04:30:00Z'), '2026-10-24');
    s = upsertPoll(s, '2026-10-25', base('a', '2026-10-26T04:30:00Z'), '2026-10-24');
    expect(Object.keys(s)).toEqual(['2026-10-25']);
    expect(s['2026-10-25'].map((p) => p.id)).toEqual(['a', 'b']);
    s = upsertPoll(s, '2026-10-25', base('a', '2026-10-26T04:30:00Z', { question: 'מי בא לאיכות?' }), '2026-10-24');
    expect(s['2026-10-25'].find((p) => p.id === 'a')?.question).toBe('מי בא לאיכות?');
    expect(removePoll(s, '2026-10-25', 'a', '2026-10-24')['2026-10-25'].map((p) => p.id)).toEqual(['b']);
  });
  it('due once its moment came, never again once sent', () => {
    let s = upsertPoll({}, '2026-10-25', base('a', '2026-10-26T04:30:00Z'), '2026-10-24');
    expect(duePolls(s, '2026-10-26T04:25:00Z')).toEqual([]);
    expect(duePolls(s, '2026-10-26T04:30:00Z').map((x) => x.poll.id)).toEqual(['a']);
    s = upsertPoll(s, '2026-10-25', { ...s['2026-10-25'][0], publishedAt: '2026-10-26T04:30:00Z' }, '2026-10-24');
    expect(duePolls(s, '2026-10-26T05:00:00Z')).toEqual([]);
    expect(pendingOf(s['2026-10-25'])).toEqual([]);
  });
  it('a poll needs a question, two answers, and to close after it goes out', () => {
    const now = '2026-10-24T19:00:00Z';
    expect(validPoll(base('a', '2026-10-26T04:30:00Z'), now)).toBeNull();
    expect(validPoll(base('a', '2026-10-26T04:30:00Z', { question: ' ' }), now)).toBe('question');
    expect(validPoll(base('a', '2026-10-26T04:30:00Z', { options: ['כן'] }), now)).toBe('options');
    expect(validPoll(base('a', '2026-10-26T04:30:00Z', { closesAt: '2026-10-26T04:31:00Z' }), now)).toBe('closesAt');
  });
});
