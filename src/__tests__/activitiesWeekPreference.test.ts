import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { activityWeekStart, MONDAY_WEEK, SUNDAY_WEEK, weekStartOn } from '@/lib/utils';

/**
 * The activities screen follows the member's own week (WeekStartSetting), like the
 * feed's highlight card and the profile. It stayed Monday–Sunday, so a Sunday-week
 * member's weekly km there disagreed with the card above the feed.
 */
const page = readFileSync(new URL('../app/(app)/dashboard/activities/page.tsx', import.meta.url), 'utf8');

describe('activities week', () => {
  it("cuts the member's own week by their choice, and the whole club by Monday", () => {
    expect(page).toMatch(/const startDay: WeekStartDay = isCoach \? MONDAY_WEEK : weekStartDayOf\(/);
    expect(page).toMatch(/getCurrentActivityWeek\(weekOffset, startDay\)/);
    expect(page).toMatch(/activityWeekStart\(a\.start_time, startDay\) === weekStartDate/);
  });

  it('puts a Sunday long run in the week a Sunday-week member is looking at', () => {
    const sundayRun = '2026-10-11T07:26:09+00:00'; // Sunday
    const sundayWeek = weekStartOn(new Date('2026-10-13T12:00:00Z'), SUNDAY_WEEK); // asked on Tuesday
    const mondayWeek = weekStartOn(new Date('2026-10-13T12:00:00Z'), MONDAY_WEEK);
    expect(activityWeekStart(sundayRun, SUNDAY_WEEK)).toBe(sundayWeek);   // 2026-10-11
    expect(activityWeekStart(sundayRun, MONDAY_WEEK)).not.toBe(mondayWeek); // last week's
  });
});
