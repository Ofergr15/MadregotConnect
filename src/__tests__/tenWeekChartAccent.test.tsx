import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import he from '../../messages/he.json';
import { TenWeekChart } from '@/components/profile/AthleteProfileBody';

/**
 * The runner's ten-week chart (y-axis, tap a week, average, the table), reused on the
 * academy's screens in purple (Ofer, 2026-10-19: "bring the weeks module from regular runners").
 */
const week = (i: number, km: number, runs: number, current = false) => ({
  weekStart: new Date(Date.UTC(2026, 7, 9 + i * 7)).toISOString().slice(0, 10),
  km, runs, paceSecPerKm: null, deltaPct: null, isCurrent: current,
});
const weeks = [week(0, 52, 5), week(1, 81, 7), week(2, 88, 8), week(3, 98, 8), week(4, 89, 7), week(5, 80, 6), week(6, 102, 8), week(7, 40, 3), week(8, 66, 6), week(9, 12, 1, true)];
const render = (props: Partial<Parameters<typeof TenWeekChart>[0]>) => renderToStaticMarkup(
  <NextIntlClientProvider locale="he" messages={he} timeZone="Asia/Jerusalem">
    <TenWeekChart weeks={weeks} title="10 השבועות האחרונים" emptyLabel="עדיין אין היסטוריית ק״מ" unit="ק״מ" currentTrendPct={null} month={null} {...props} />
  </NextIntlClientProvider>,
);

describe('TenWeekChart — the accent', () => {
  it('keeps the club look exactly: the brand classes, no purple', () => {
    const html = render({});
    expect(html).toContain('stroke-brand-600');
    expect(html).not.toContain('#7C3AED');
  });
  it('draws the same marks in the academy purple, with no brand-blue line left', () => {
    const html = render({ accent: 'academy' });
    expect(html).toContain('#7C3AED');
    expect(html).not.toContain('stroke-brand-600');
  });
  it('says so honestly when nothing was run, instead of a flat line', () => {
    const html = render({ weeks: weeks.map((w) => ({ ...w, km: 0, runs: 0 })), accent: 'academy' });
    expect(html).toContain('עדיין אין היסטוריית ק״מ');
    expect(html).not.toContain('<svg');
  });
});

describe('the academy stack uses it under the week card', () => {
  it('turns the card\'s own line off and draws the profile chart from the same stats read', () => {
    const src = readFileSync('src/components/profile/AthleteProgress.tsx', 'utf8');
    expect(src).toMatch(/tenWeeks=\{false\}/);
    expect(src).toMatch(/<TenWeekChart[\s\S]*weeks=\{stats\.weeks \|\| \[\]\}[\s\S]*accent=\{accent\}/);
  });
});

describe('in the academy, the ten weeks and the ring measure the same week', () => {
  // Shahar's real week (2026-10-19, a Monday): 11.9 km on Sunday, nothing yet on Monday;
  // his own week setting starts on Monday, the plan's on Sunday.
  const acts = [
    { id: 'a1', activity_type: 'running', start_time: '2026-10-18T06:45:28', distance: 11934, duration: 3960 },
    { id: 'a2', activity_type: 'running', start_time: '2026-10-17T07:00:00', distance: 11300, duration: 3600 },
    { id: 'a3', activity_type: 'running', start_time: '2026-10-15T07:00:00', distance: 13800, duration: 4300 },
  ];
  const nowWall = Date.UTC(2026, 9, 19, 8, 10);
  const anchor = new Date(2026, 9, 19, 12);

  it('the chart\'s current week equals the ring\'s km when cut on the plan\'s Sunday', async () => {
    const { buildPlanWeek } = await import('@/lib/athletes/plan-week');
    const { buildKmTable } = await import('@/lib/athletes/profile-stats');
    const { weekStartOn } = await import('@/lib/utils');
    const ring = buildPlanWeek(acts, nowWall);
    const plan = buildKmTable(acts, { limit: 10, currentWeekStart: weekStartOn(anchor, 0), startDay: 0 });
    const current = plan.find((w) => w.isCurrent)!;
    expect(current.km).toBe(ring.km);
    expect(ring.km).toBeCloseTo(11.9, 1);
    // On his own Monday week the same chart said 0 — the contradiction this removes.
    const own = buildKmTable(acts, { limit: 10, currentWeekStart: weekStartOn(anchor, 1), startDay: 1 });
    expect(own.find((w) => w.isCurrent)!.km).toBe(0);
  });

  it('the academy stack asks for the plan week; the stats route honours it, and nothing else changes', () => {
    expect(readFileSync('src/components/profile/AthleteProgress.tsx', 'utf8')).toMatch(/accent === 'academy' \? '\?week=plan' : ''/);
    expect(readFileSync('src/app/api/athletes/[id]/stats/route.ts', 'utf8')).toMatch(/get\('week'\) === 'plan' \? \(0 as typeof ownStartDay\) : ownStartDay/);
    expect(readFileSync('src/components/profile/AthleteProfileBody.tsx', 'utf8')).toMatch(/useApi<StatsData>\(\s*athleteId \? `\/api\/athletes\/\$\{athleteId\}\/stats` : null/);
  });
});
