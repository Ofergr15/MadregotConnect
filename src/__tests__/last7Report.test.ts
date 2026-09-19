import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  buildLast7Report, formatReportHours, formatReportPace, reportIsEmpty,
  type ReportActivity,
} from '@/lib/reports/last-7-days';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * The seven-day report: one window, two surfaces — the Saturday 18:00 push and the
 * card on the profile. These tests pin the three things that would let the two
 * disagree with each other or with the leaderboard: the window bounds, which day a
 * run lands in, and how the pace is averaged.
 */

const run = (start: string, km: number, secs: number, type = 'running'): ReportActivity => ({
  activity_type: type, start_time: start, distance: km * 1000, duration: secs,
});

describe('buildLast7Report — the window', () => {
  it('is seven days ending today, inclusive, oldest first', () => {
    const r = buildLast7Report([], '2026-09-19');
    expect(r.days).toHaveLength(7);
    expect(r.from).toBe('2026-09-13');
    expect(r.to).toBe('2026-09-19');
    expect(r.days[0].date).toBe('2026-09-13');
    expect(r.days[6].date).toBe('2026-09-19');
  });

  it('labels every day with its real weekday, 0 = Sunday', () => {
    // 2026-09-19 is a Saturday, so the window opens on a Sunday.
    const r = buildLast7Report([], '2026-09-19');
    expect(r.days.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('drops anything outside the window rather than trusting the caller', () => {
    const r = buildLast7Report([
      run('2026-09-12T06:00:00Z', 10, 3000), // the day before it opens
      run('2026-09-20T06:00:00Z', 10, 3000), // the day after it closes
      run('2026-09-15T06:00:00Z', 10, 3000),
    ], '2026-09-19');
    expect(r.km).toBeCloseTo(10);
    expect(r.runs).toBe(1);
  });
});

describe('buildLast7Report — which day a run lands in', () => {
  it('buckets by the Israel date, not the UTC one', () => {
    // 22:30 Israel on the 16th is 19:30 UTC the same day, but 00:30 Israel on the
    // 17th is 21:30 UTC on the 16th — that one belongs to the 17th.
    const r = buildLast7Report([run('2026-09-16T21:30:00Z', 5, 1500)], '2026-09-19');
    const byDate = Object.fromEntries(r.days.map((d) => [d.date, d.km]));
    expect(byDate['2026-09-17']).toBeCloseTo(5);
    expect(byDate['2026-09-16']).toBe(0);
  });

  it('adds up two runs on the same day', () => {
    const r = buildLast7Report([
      run('2026-09-15T05:00:00Z', 8, 2400),
      run('2026-09-15T16:00:00Z', 12, 3600),
    ], '2026-09-19');
    const day = r.days.find((d) => d.date === '2026-09-15')!;
    expect(day.km).toBeCloseTo(20);
    expect(day.runs).toBe(2);
    expect(day.seconds).toBe(6000);
  });
});

describe('buildLast7Report — what counts', () => {
  it('counts runs of every flavour the recap has always counted', () => {
    const r = buildLast7Report([
      run('2026-09-15T05:00:00Z', 10, 3000, 'trail_running'),
      run('2026-09-16T05:00:00Z', 10, 3000, 'treadmill_running'),
      run('2026-09-17T05:00:00Z', 10, 3000, 'track_running'),
      run('2026-09-18T05:00:00Z', 10, 3000, 'virtual_run'),
    ], '2026-09-19');
    expect(r.runs).toBe(4);
  });

  it('ignores a ride, a swim and a walk — a week of running is runs', () => {
    const r = buildLast7Report([
      run('2026-09-15T05:00:00Z', 40, 4000, 'cycling'),
      run('2026-09-16T05:00:00Z', 2, 2000, 'walking'),
      run('2026-09-17T05:00:00Z', 1, 1800, 'lap_swimming'),
    ], '2026-09-19');
    expect(reportIsEmpty(r)).toBe(true);
    expect(r.km).toBe(0);
  });

  it('ignores a zero-distance row, which is what a gym session looks like', () => {
    const r = buildLast7Report(
      [{ activity_type: 'running', start_time: '2026-09-15T05:00:00Z', distance: 0, duration: 1800 }],
      '2026-09-19',
    );
    expect(r.runs).toBe(0);
    expect(r.seconds).toBe(0);
  });

  it('keeps a row with no activity_type at all — Strava rows arrive that way', () => {
    const r = buildLast7Report(
      [{ start_time: '2026-09-15T05:00:00Z', distance: 5000, duration: 1500 }],
      '2026-09-19',
    );
    expect(r.runs).toBe(1);
  });
});

describe('buildLast7Report — the pace', () => {
  it('is distance-weighted, so a 3 km jog cannot drag a 30 km week around', () => {
    // 30 km at 4:00 and 3 km at 6:00 -> 7200+1080 s over 33 km = 250.9 s/km (4:11).
    const r = buildLast7Report([
      run('2026-09-15T05:00:00Z', 30, 7200),
      run('2026-09-16T05:00:00Z', 3, 1080),
    ], '2026-09-19');
    expect(formatReportPace(r.paceSeconds!)).toBe('4:11');
    // The average of the two paces would have been 5:00 — the number this avoids.
    expect(r.paceSeconds).toBeLessThan(300);
  });

  it('is null, not zero and not NaN, when nothing was run', () => {
    const r = buildLast7Report([], '2026-09-19');
    expect(r.paceSeconds).toBeNull();
    expect(reportIsEmpty(r)).toBe(true);
  });
});

describe('the two formatters', () => {
  it('a pace is m:ss with a padded second', () => {
    expect(formatReportPace(240)).toBe('4:00');
    expect(formatReportPace(283)).toBe('4:43');
    expect(formatReportPace(359.6)).toBe('6:00');
  });

  it('a week is h:mm — hours, not a stopwatch', () => {
    expect(formatReportHours(40_560)).toBe('11:16');
    expect(formatReportHours(0)).toBe('0:00');
    expect(formatReportHours(3540)).toBe('0:59');
  });
});

describe('the Saturday 18:00 send', () => {
  const tick = read('app/api/cron/tick/route.ts');

  it('fires on Saturday at 18:00 Israel, not the old Sunday 19:00', () => {
    expect(tick).toMatch(/if \(weekday === 6 && hour === 18\) \{/);
    expect(tick).not.toMatch(/weekday === 0 && hour === 19/);
  });

  it('is idempotent per Saturday through its own ledger tag', () => {
    // A new tag, not the old `recap:` one: the window changed, so a Saturday that
    // already fired under the old scheme must not look like this one.
    expect(tick).toMatch(/const tag = `report7:\$\{reportTo\}`;/);
    expect(tick).toMatch(/if \(!\(await already\(tag\)\)\) \{/);
  });

  it('reads one day past the window, so a run started late today is inside it', () => {
    expect(tick).toMatch(/const readUntil = addDaysToDateStr\(reportTo, 1\);/);
    expect(tick).toMatch(/\.gte\('start_time', reportFrom\)/);
    expect(tick).toMatch(/\.lt\('start_time', readUntil\)/);
  });

  it('builds each athlete from the shared builder, not its own inline fold', () => {
    // The whole reason the builder exists: the push and the profile card must not
    // be able to print two different numbers for the same seven days.
    expect(tick).toMatch(/buildLast7Report\(list, reportTo\)/);
    expect(tick).toMatch(/formatReportPace\(report\.paceSeconds\)/);
    expect(tick).not.toMatch(/const RUN_TYPES = \['running'/);
  });

  it('sends nothing to an athlete who did not run', () => {
    expect(tick).toMatch(/if \(!reportIsEmpty\(report\)\) per\.set\(athleteId, report\);/);
  });

  it('points at the profile, where the same seven days are drawn', () => {
    const at = tick.indexOf('`report7:${reportTo}`');
    const block = tick.slice(at, at + 3500);
    expect(block).toMatch(/url: '\/dashboard\/profile'/);
  });

  it('still batches the subscription read and sends concurrently', () => {
    // Regression guard on the 60s-timeout fix that this rewrite passed through.
    const at = tick.indexOf('`report7:${reportTo}`');
    const block = tick.slice(at, at + 3500);
    expect(block).toMatch(/await subscriptionsForAthletes\(runnerIds\)/);
    expect(block).toMatch(/await Promise\.all\(/);
  });
});

describe('the profile card', () => {
  const card = read('components/profile/Last7DaysCard.tsx');

  it('renders from the payload, deriving no window of its own', () => {
    expect(card).toMatch(/report\.days\.map/);
    expect(card).not.toMatch(/buildLast7Report\(/);
  });

  it('gives every day the same colour', () => {
    // "i want same color all days" — the only conditional on a bar is ran-vs-rested.
    expect(card).toMatch(/d\.km > 0 \? 'bg-brand-600' : 'bg-ink-300\/40'/);
    expect(card).not.toMatch(/isBest|bestDay|peakDay/);
  });

  it('runs its day axis left-to-right even in Hebrew', () => {
    expect(card).toMatch(/dir="ltr"/);
  });

  it('says which seven days it means, so it cannot be read as "this week"', () => {
    expect(card).toMatch(/\{fd\(report\.from\)\} – \{fd\(report\.to\)\}/);
  });

  it('has an empty state instead of seven flat bars', () => {
    expect(card).toMatch(/report\.runs === 0 \?/);
    expect(card).toMatch(/last7Empty/);
  });
});

describe('the card is on the profile and its labels exist in both languages', () => {
  it('is wired into the profile body above the ten-week chart', () => {
    const body = read('components/profile/AthleteProfileBody.tsx');
    expect(body).toMatch(/\{stats\?\.last7 && <Last7DaysCard report=\{stats\.last7\} \/>\}/);
    expect(body.indexOf('<Last7DaysCard')).toBeLessThan(body.indexOf('<TenWeekChart'));
  });

  it('is served by the stats route the profile already reads', () => {
    // Deliberately not a new endpoint: it is folded out of the activities read the
    // route already performs, so it costs nothing and cannot disagree with the
    // week table beside it.
    const route = read('app/api/athletes/[id]/stats/route.ts');
    expect(route).toMatch(/last7: buildLast7Report\(acts, israelToday\(\)\)/);
  });

  it('has every key in he and en', () => {
    const keys = ['last7Title', 'last7Empty', 'last7Km', 'last7Hours', 'last7Pace', 'last7Runs'];
    const he = JSON.parse(readFileSync(join(SRC, '../messages/he.json'), 'utf8')).profile;
    const en = JSON.parse(readFileSync(join(SRC, '../messages/en.json'), 'utf8')).profile;
    for (const k of keys) {
      expect(he[k], `he.${k}`).toBeTruthy();
      expect(en[k], `en.${k}`).toBeTruthy();
    }
  });
});
