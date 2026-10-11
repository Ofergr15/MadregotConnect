import { describe, expect, it } from 'vitest';
import { rowMarks, talkCounts, type BoardMarks } from '@/lib/academy/board-server';

/**
 * The week board's footer marks (screen 2), the pure halves: how many messages are about
 * each day of the week, and which marks a row shows — only the true ones (no 💬 0).
 */

const WEEK = '2026-10-11';
const END = '2026-10-17';

describe('talkCounts', () => {
  it('counts the messages tagged with each day of this week, never the review cards or blanks', () => {
    const counts = talkCounts([
      { text: 'איך היה?', workout_date: '2026-10-13' },
      { text: 'טוב', workout_date: '2026-10-13' },
      { text: '', workout_date: '2026-10-13' },
      { text: 'review', workout_date: '2026-10-13', academy_feedback: { note: 'x' } as never },
      { text: 'last week', workout_date: '2026-10-08' },
      { text: 'untagged' },
      { text: 'Saturday', workout_date: END },
    ], WEEK, END);
    expect(Object.fromEntries(counts)).toEqual({ '2026-10-13': 2, [END]: 1 });
  });
});

describe('rowMarks', () => {
  const marks: BoardMarks = {
    byActivity: new Map([['run1', { feel: 3, pr: '1k', comment: 'קצר בגלל החום' }], ['run2', {}]]),
    commentsByDate: new Map([['2026-10-13', 2]]),
    threadRead: true,
  };

  it('feel, comments and a record, when true', () => {
    expect(rowMarks(marks, '2026-10-13', 'run1')).toEqual({ feel: 3, comments: 2, pr: '1k' });
  });

  it('nothing is a mark at zero; a planned day with no run shows only its comments', () => {
    expect(rowMarks(marks, '2026-10-14', 'run2')).toEqual({});
    expect(rowMarks(marks, '2026-10-13', null)).toEqual({ comments: 2 });
  });
});
