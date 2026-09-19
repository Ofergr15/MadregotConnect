import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  isWeekSummaryWindow, weekSummaryAnchor, weekSummaryDismissKey,
  WEEK_SUMMARY_CLOSE_HOUR, WEEK_SUMMARY_OPEN_HOUR,
} from '@/lib/reports/week-summary-window';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * The feed's weekly-summary window. Everything worth pinning here comes from the
 * fact that it crosses midnight: the boundaries, and the dismissal key that has
 * to stay the same on both sides of it.
 */

describe('when the summary sits at the top of the feed', () => {
  it('opens on the Saturday 18:00 tick, with the push', () => {
    expect(isWeekSummaryWindow({ weekday: 6, hour: WEEK_SUMMARY_OPEN_HOUR })).toBe(true);
    expect(isWeekSummaryWindow({ weekday: 6, hour: 23 })).toBe(true);
  });

  it('is not there on Saturday afternoon, before the week has closed', () => {
    expect(isWeekSummaryWindow({ weekday: 6, hour: 17 })).toBe(false);
    expect(isWeekSummaryWindow({ weekday: 6, hour: 0 })).toBe(false);
  });

  it('carries over into Sunday morning and stops at 10:00', () => {
    expect(isWeekSummaryWindow({ weekday: 0, hour: 0 })).toBe(true);
    expect(isWeekSummaryWindow({ weekday: 0, hour: 9 })).toBe(true);
    expect(isWeekSummaryWindow({ weekday: 0, hour: WEEK_SUMMARY_CLOSE_HOUR })).toBe(false);
  });

  it('is absent every other day of the week', () => {
    for (const weekday of [1, 2, 3, 4, 5]) {
      for (const hour of [0, 9, 18, 23]) {
        expect(isWeekSummaryWindow({ weekday, hour }), `day ${weekday} ${hour}:00`).toBe(false);
      }
    }
  });
});

describe('which week is being shown', () => {
  it('is the day itself on Saturday', () => {
    expect(weekSummaryAnchor('2026-09-19', 6)).toBe('2026-09-19');
  });

  it('is still the Saturday when read on Sunday morning', () => {
    expect(weekSummaryAnchor('2026-09-20', 0)).toBe('2026-09-19');
  });

  it('crosses a month boundary backwards', () => {
    expect(weekSummaryAnchor('2026-10-01', 0)).toBe('2026-09-30');
  });
});

describe('the dismissal', () => {
  it('uses one key per Saturday, so closing it at 23:00 keeps it closed at 08:00', () => {
    const sat = weekSummaryDismissKey(weekSummaryAnchor('2026-09-19', 6));
    const sun = weekSummaryDismissKey(weekSummaryAnchor('2026-09-20', 0));
    expect(sat).toBe(sun);
    expect(sat).toBe('mc:weekSummaryDismissed:2026-09-19');
  });

  it('does not carry into the following week', () => {
    expect(weekSummaryDismissKey('2026-09-19')).not.toBe(weekSummaryDismissKey('2026-09-26'));
  });
});

describe('the feed card', () => {
  const card = read('components/feed/WeekSummaryCard.tsx');

  it('renders nothing outside the window', () => {
    expect(card).toMatch(/if \(!isWeekSummaryWindow\(\{ weekday, hour \}\)\) return;/);
    expect(card).toMatch(/if \(dismissed \|\| !report\) return null;/);
  });

  it('builds the report against the Saturday, not against today', () => {
    expect(card).toMatch(/buildLast7Report\(acts, anchor\)/);
  });

  it('reads the activities the feed can already ask for, adding no endpoint', () => {
    expect(card).toMatch(/fetchActivities\(\{ selfOnly: true, sinceDays: 8 \}\)/);
    expect(card).not.toMatch(/fetch\('\/api\//);
  });

  it('keys the X to the Saturday', () => {
    expect(card).toMatch(/localStorage\.setItem\(weekSummaryDismissKey\(weekSummaryAnchor\(israelToday\(\), weekday\)\)/);
  });

  it('stays quiet in a week with no runs', () => {
    expect(card).toMatch(/built\.runs > 0/);
  });

  it('carries the same share sheet as the profile card', () => {
    expect(card).toMatch(/<WeekShareSheet report=\{report\}/);
  });

  it('is mounted at the top of the feed, above the setup nudge', () => {
    const feed = read('app/(app)/feed/page.tsx');
    expect(feed).toMatch(/<WeekSummaryCard \/>/);
    // empty:mb-0 so the six days it renders nothing cost no vertical space.
    expect(feed).toMatch(/empty:mb-0">\s*<WeekSummaryCard \/>/);
    expect(feed.indexOf('<WeekSummaryCard />')).toBeLessThan(feed.indexOf('<SetupNudgeCard />'));
  });
});
