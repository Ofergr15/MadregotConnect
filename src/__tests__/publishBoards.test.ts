import { describe, expect, it } from 'vitest';
import { boardCounts, boardStates, sessionBoardsPublished } from '@/lib/plans/publish-boards';
import type { GroupedWeeklyPlans, ParsedWorkout } from '@/lib/ai/types';

const w = (name: string, published = false): ParsedWorkout => ({
  dayOfWeek: 0,
  name,
  steps: [],
  ...(published ? { clipboardImageUrl: `https://cdn/${name}.png` } : {}),
});

const plan = (...flags: boolean[][]): GroupedWeeklyPlans => ({
  group1: { workouts: flags.map((f, i) => w(`s${i}`, f[0])) },
  group2: { workouts: flags.map((f, i) => w(`s${i}`, f[1])) },
  group3: { workouts: flags.map((f, i) => w(`s${i}`, f[2])) },
});

describe('boardStates', () => {
  it('lists three boards per session, session-major', () => {
    const boards = boardStates(plan([true, true, true], [true, false, false]));
    expect(boards).toHaveLength(6);
    expect(boards.map((b) => `${b.index}${b.group}`)).toEqual(['01', '02', '03', '11', '12', '13']);
    expect(boards.map((b) => b.published)).toEqual([true, true, true, true, false, false]);
  });

  it('counts a nine-session week as twenty-seven boards', () => {
    const nine = plan(...Array.from({ length: 9 }, () => [false, false, false]));
    expect(boardCounts(nine)).toEqual({ published: 0, total: 27 });
  });
});

describe('boardCounts', () => {
  it('does not call a plan published because group ❶ is', () => {
    // What the old "published" badge said, on the tab that happened to be open.
    expect(boardCounts(plan([true, false, false]))).toEqual({ published: 1, total: 3 });
  });
});

describe('sessionBoardsPublished', () => {
  it('answers 0..3 for one session', () => {
    const p = plan([true, true, false], [false, false, false]);
    expect(sessionBoardsPublished(p, 0)).toBe(2);
    expect(sessionBoardsPublished(p, 1)).toBe(0);
  });

  it('is 0 for an index the plan does not have', () => {
    expect(sessionBoardsPublished(plan([true, true, true]), 7)).toBe(0);
  });
});
