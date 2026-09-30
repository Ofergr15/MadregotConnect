import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, buildRangeRuns, calendarCells, monthRange, parseRunsRange, MAX_RANGE_DAYS } from '@/lib/athletes/runs-range';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('runs-range: one window of runs for the profile views', () => {
  it('takes a week or a month and nothing wider or malformed', () => {
    expect(parseRunsRange('2026-09-20', '2026-09-27')).toEqual({ from: '2026-09-20', to: '2026-09-27' });
    expect(parseRunsRange('2026-09-01', '2026-10-01')).not.toBeNull();
    expect(parseRunsRange('2026-01-01', '2026-03-01')).toBeNull();
    expect(parseRunsRange('2026-09-27', '2026-09-20')).toBeNull();
    expect(parseRunsRange('2026-09-20', '2026-09-20')).toBeNull();
    expect(parseRunsRange('2026-9-1', '2026-10-01')).toBeNull();
    expect(parseRunsRange(null, '2026-10-01')).toBeNull();
    expect(MAX_RANGE_DAYS).toBe(42);
  });

  it('walks days and months across their edges', () => {
    expect(addDays('2026-09-27', 7)).toBe('2026-10-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(monthRange('2026-09-30')).toEqual({ from: '2026-09-01', to: '2026-10-01' });
    expect(monthRange('2026-12-15')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  it('lays a month out Sunday-first with the kilometres of each day', () => {
    const runs = buildRangeRuns([
      { id: 'a', activity_name: 'Easy', activity_type: 'running', start_time: '2026-09-29T04:10:00Z', distance: 7100, duration: 2420, route_preview: [{ lat: 32.1, lng: 34.8 }, { lat: 32.2, lng: 34.9 }, { lat: 32.3, lng: 34.8 }] },
      { id: 'b', activity_name: 'Long', activity_type: 'running', start_time: '2026-09-26T03:00:00Z', distance: 24000, duration: 7680, route_preview: null },
    ]);
    expect(runs.map((r) => r.id)).toEqual(['a', 'b']);
    expect(runs[0].routePreview).toHaveLength(3);
    expect(runs[1].routePreview).toBeNull();
    const cells = calendarCells('2026-09-01', runs);
    // September 2026 starts on a Tuesday: two blanks, then 30 days.
    expect(cells.slice(0, 2)).toEqual([null, null]);
    expect(cells.filter(Boolean)).toHaveLength(30);
    expect(cells.find((c) => c?.day === '2026-09-26')?.km).toBe(24);
    expect(cells.find((c) => c?.day === '2026-09-29')?.runs.map((r) => r.id)).toEqual(['a']);
    expect(cells.find((c) => c?.day === '2026-09-28')?.km).toBe(0);
  });
});

describe('GET /api/athletes/[id]/runs', () => {
  const route = src('src/app/api/athletes/[id]/runs/route.ts');
  it('is super user only while the views are tried, and never reads a spoofable header', () => {
    expect(route).toMatch(/resolveVerifiedCaller\(request\)/);
    expect(route).toMatch(/if \(!caller\.isSuperUser\) return NextResponse\.json\(\{ error: 'forbidden' \}, \{ status: 403 \}\)/);
    expect(route).not.toMatch(/x-user-email/);
  });
  it('hides a pending runner, bounds the window and selects no credential column', () => {
    expect(route).toMatch(/isPendingAthlete/);
    expect(route).toMatch(/parseRunsRange/);
    expect(route).toMatch(/status: 400/);
    expect(route).toMatch(/\.select\('id, activity_name, activity_type, start_time, distance, duration, route_preview'\)/);
    expect(route).toMatch(/\.gte\('start_time', range\.from\)[\s\S]*\.lt\('start_time', range\.to\)/);
  });
});

describe('the profile runs tab', () => {
  const body = src('src/components/profile/AthleteProfileBody.tsx');
  const browser = src('src/components/profile/RunsBrowser.tsx');
  it('shows the weeks/calendar browser to the super user and the old list to everyone else', () => {
    expect(body).toMatch(/section === 'runs' && superUser && athleteId && <RunsBrowser/);
    expect(body).toMatch(/section === 'runs' && !superUser &&/);
  });
  it('switches between weeks and calendar, and every run opens its page', () => {
    expect(browser).toMatch(/value: 'weeks'[\s\S]*value: 'calendar'/);
    expect(browser).toMatch(/href=\{`\/dashboard\/activities\/\$\{r\.id\}`\}/);
    expect(browser).toMatch(/<RouteMinimap/);
    expect(browser).toMatch(/<PrBadge/);
    expect(browser).toMatch(/disabled=\{isThisMonth\}/);
  });
  it('has every key in both languages', () => {
    const he = JSON.parse(src('messages/he.json')).profile;
    const en = JSON.parse(src('messages/en.json')).profile;
    for (const k of ['runsViewWeeks', 'runsViewCalendar', 'runsWeekOf', 'runsThisWeek', 'runsNoneInWeek', 'runsNoneInMonth', 'runsPrevMonth', 'runsNextMonth', 'runsCount']) {
      expect(he[k], k).toBeTruthy();
      expect(en[k], k).toBeTruthy();
    }
  });
});
