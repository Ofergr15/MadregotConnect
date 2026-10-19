import { describe, expect, it } from 'vitest';
import { activeClubStories, pruneClubStories, readClubStories, untilFor, type ClubStory } from '@/lib/feed/club-stories';

const s = (id: string, from: string, until: string, createdAt = `${from}T10:00:00Z`): ClubStory => ({ id, title: 't', text: 'x', from, until, createdAt });

describe('the Madregot circle', () => {
  it('counts the days from today: today only, two days, a week', () => {
    expect(untilFor('2026-10-19', 1)).toBe('2026-10-19');
    expect(untilFor('2026-10-19', 2)).toBe('2026-10-20');
    expect(untilFor('2026-10-19', 7)).toBe('2026-10-25');
  });

  it('is on the row from its first day through its last, newest first', () => {
    const list = [s('a', '2026-10-17', '2026-10-18'), s('b', '2026-10-19', '2026-10-20'), s('c', '2026-10-18', '2026-10-25', '2026-10-18T09:00:00Z')];
    expect(activeClubStories(list, '2026-10-19').map(x => x.id)).toEqual(['b', 'c']);
    expect(activeClubStories(list, '2026-10-18').map(x => x.id)).toEqual(['c', 'a']);
  });

  it('reads nothing broken, and forgets what ended over two weeks ago', () => {
    expect(readClubStories('not json')).toEqual([]);
    expect(readClubStories('[{"id":1}]')).toEqual([]);
    expect(pruneClubStories([s('old', '2026-09-01', '2026-09-02'), s('new', '2026-10-19', '2026-10-19')], '2026-10-19').map(x => x.id)).toEqual(['new']);
  });
});

describe('how long a celebration stays', () => {
  it('reads the birthday default, one day when unset or odd, and counts days from the day itself', async () => {
    const { readBirthdayDays, untilAfter } = await import('@/lib/feed/celebration-days');
    expect(readBirthdayDays(null)).toBe(1);
    expect(readBirthdayDays('5')).toBe(1);
    expect(readBirthdayDays('3')).toBe(3);
    expect(untilAfter('2026-10-19', 1)).toBe('2026-10-19');
    expect(untilAfter('2026-10-19', 3)).toBe('2026-10-21');
  });
});
