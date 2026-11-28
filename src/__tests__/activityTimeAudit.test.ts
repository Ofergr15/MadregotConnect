import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activityLocalDateStr, formatActivityDateWith, israelToday } from '@/lib/utils';

/**
 * Task 195: activity times through the utils helpers. `start_time` is the athlete's
 * wall clock stored as UTC parts (CLAUDE.md), so any local getter or an unpinned
 * toLocale* reads it in the VIEWER's timezone — an Israel browser moves a 22:30 run
 * onto the next day.
 */

describe('formatActivityDateWith', () => {
  // The browser case: run with TZ=Asia/Jerusalem the old code printed the 28th.
  it('a 22:30 run stays on its own day whatever the options', () => {
    expect(formatActivityDateWith('2026-11-27T22:30:00+00:00', 'en-US', { day: 'numeric', month: 'short' })).toBe('Nov 27');
    expect(formatActivityDateWith('2026-11-27T23:59:00Z', 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })).toBe('Fri, Nov 27');
  });
  it('a caller cannot unpin the timezone', () => {
    expect(formatActivityDateWith('2026-11-27T22:30:00Z', 'en-US', { day: 'numeric', timeZone: 'Asia/Jerusalem' })).toBe('27');
  });
  it('a start_time with no offset is read as the wall clock too', () => {
    expect(formatActivityDateWith('2026-11-27 23:10:00', 'en-US', { day: 'numeric' })).toBe('27');
  });
  it('Hebrew output stays on the same day', () => {
    expect(formatActivityDateWith('2026-11-27T22:30:00Z', 'he-IL', { day: 'numeric', month: 'numeric' })).toMatch(/27/);
  });
});

describe('champions race date', () => {
  it('is the activity\'s own calendar day, not Israel time of the UTC parts', () => {
    // The old `toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })` gave 2026-11-28 here.
    expect(activityLocalDateStr('2026-11-27T22:30:00Z')).toBe('2026-11-27');
    const src = readFileSync('src/lib/champions/server.ts', 'utf8');
    expect(src).toMatch(/raceDate: activityLocalDateStr\(a\.start_time\)/);
  });
});

describe('GoalSheet today', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('is the Israel day, not the UTC day (00:00–03:00 Israel is still yesterday in UTC)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T22:30:00Z')); // 00:30 on the 28th in Israel
    expect(israelToday()).toBe('2026-11-28');
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-11-27');
    expect(readFileSync('src/components/academy/completion/GoalSheet.tsx', 'utf8')).toMatch(/ctx\?\.today \?\? israelToday\(\)/);
  });
});

describe('ratchet: no local-timezone reads of an activity time in src', () => {
  // `new Date(x.start_time).getHours()` / `.toLocaleDateString(...)` and friends.
  const BAD = /new Date\(\s*[\w.?!\[\]]*(start_time|startTime)!?\s*\)\s*\.(get(Day|Date|Hours|Minutes|Month|FullYear)|toLocale\w*String|toDateString|toTimeString)\(/;
  const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.includes('__tests__'));
  it('scans the source tree', () => expect(files.length).toBeGreaterThan(500));
  it('finds none', () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (BAD.test(line) && !/^\s*(\/\/|\*)/.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
