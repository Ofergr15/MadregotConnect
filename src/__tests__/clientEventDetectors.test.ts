import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  CLIENT_EVENT_KINDS, compareVersions, errorShape, sanitiseEvents,
  type ClientEventRow,
} from '@/lib/bugs/client-events';
import {
  CLIENT_DETECTORS, LIVE_DETECTORS, PENDING_DETECTORS,
  detectBlankScreen, detectClientError, detectDroppedForm, detectServerError,
  detectStuckVersion, detectSuspiciousPace,
  type ActivityRow,
} from '@/lib/bugs/detectors';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * THE FIVE DETECTORS THAT READ THE BROWSER, plus the one that reads for data
 * that is wrong rather than missing.
 *
 * What is pinned here, in order of how much damage getting it wrong would do:
 *
 *  1. NOTHING PERSONAL CROSSES THE WIRE. A query string carries invite tokens; a
 *     form value is somebody's private text. Neither may be storable, and that is
 *     a property of `sanitiseEvents`, not of the callers' good manners.
 *  2. NO IDENTITY IN THE BODY. The athlete comes from the session. A route that
 *     read it from the payload would let anybody file events as anybody.
 *  3. ONE PHONE IS NOT A BUG. Every grouped detector needs two people before it
 *     is a finding, or the board becomes a list of one athlete's ageing Android.
 *  4. "NOT CHECKED" IS NOT "FOUND NOTHING". Until migration 118 is applied these
 *     five must say the first of those, out loud.
 */

const NOW = new Date('2026-09-22T03:12:00Z').getTime();
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString();

const ev = (over: Partial<ClientEventRow> = {}): ClientEventRow => ({
  id: Math.random().toString(36).slice(2),
  athlete_id: 'a1',
  kind: 'error',
  route: '/dashboard',
  message: 'Loading chunk 4f3a1b failed',
  app_version: '2.40.99',
  created_at: hoursAgo(2),
  ...over,
});

describe('what the browser is allowed to send', () => {
  it('drops the query string, because that is where the invite tokens are', () => {
    const [e] = sanitiseEvents({ events: [{ kind: 'error', route: '/join/abc?token=secret' }] });
    expect(e.route).toBe('/join/abc');
    expect(JSON.stringify(e)).not.toContain('secret');
  });

  it('keeps the ids in the path, which is how you see a page break for one person', () => {
    const [e] = sanitiseEvents({ events: [{ kind: 'blank', route: '/dashboard/teammate/u-7' }] });
    expect(e.route).toBe('/dashboard/teammate/u-7');
  });

  it('refuses a kind nothing detects — a kind with no reader is data for its own sake', () => {
    expect(sanitiseEvents({ events: [{ kind: 'pageview' }] })).toEqual([]);
    expect(CLIENT_EVENT_KINDS).toHaveLength(5);
  });

  it('drops one bad event without losing the good ones in the same batch', () => {
    const out = sanitiseEvents({ events: [{ kind: 'error' }, null, { kind: 'nope' }, { kind: 'boot' }] });
    expect(out.map(e => e.kind)).toEqual(['error', 'boot']);
  });

  it('caps a batch, so the endpoint cannot be used as storage', () => {
    const many = Array.from({ length: 60 }, () => ({ kind: 'error', message: 'x' }));
    expect(sanitiseEvents({ events: many })).toHaveLength(20);
  });

  it('truncates a message rather than rejecting it', () => {
    const [e] = sanitiseEvents({ events: [{ kind: 'error', message: 'e'.repeat(5000) }] });
    expect(e.message!.length).toBe(300);
  });

  it('takes the version from the client, but only if it looks like a version', () => {
    // The client's build is the ONE field that has to come from the browser:
    // stuck_version is the question of whether it differs from the server's.
    expect(sanitiseEvents({ events: [{ kind: 'boot', appVersion: '2.40.99' }] })[0].app_version)
      .toBe('2.40.99');
    expect(sanitiseEvents({ events: [{ kind: 'boot', appVersion: 'drop table' }] })[0].app_version)
      .toBeNull();
  });

  it('never accepts an athlete id from the body', () => {
    const [e] = sanitiseEvents({ events: [{ kind: 'error', athlete_id: 'somebody-else' }] });
    expect(JSON.stringify(e)).not.toContain('somebody-else');
    // And the route stamps it from the session instead.
    expect(read('app/api/client-events/route.ts')).toMatch(/athlete_id: caller\.athleteId/);
  });

  it('is a write-only door: no GET, and nothing reads events back out', () => {
    const route = read('app/api/client-events/route.ts');
    expect(route).toMatch(/export async function POST/);
    expect(route).not.toMatch(/export async function GET/);
    expect(route).toMatch(/resolveVerifiedCaller/);
  });

  it('does not read x-user-email, which is gone repo-wide', () => {
    expect(read('app/api/client-events/route.ts')).not.toContain('x-user-email');
  });
});

describe('collapsing an error to its shape', () => {
  it('makes one finding out of the same chunk failure on twelve phones', () => {
    // This is the failure the whole grouping exists for: a deploy leaves phones
    // asking for chunks that no longer exist, with a different hash every time.
    expect(errorShape('Loading chunk 4f3a1b failed'))
      .toBe(errorShape('Loading chunk 9c02de77 failed'));
  });

  it('keeps two genuinely different errors apart', () => {
    expect(errorShape('Cannot read properties of undefined'))
      .not.toBe(errorShape('Loading chunk 4f3a failed'));
  });

  it('strips urls and quoted values, which vary per device and diagnose nothing', () => {
    const shape = errorShape("failed to fetch https://x.test/api/a 'dana'");
    expect(shape).not.toContain('x.test');
    expect(shape).not.toContain('dana');
  });
});

describe('comparing two builds', () => {
  it('knows 2.40.9 is older than 2.40.10, which a string comparison gets backwards', () => {
    // Getting this wrong reports the entire club as stale on the day the patch
    // number crosses a ten.
    expect(compareVersions('2.40.9', '2.40.10')).toBeLessThan(0);
    expect(compareVersions('2.41.0', '2.40.99')).toBeGreaterThan(0);
  });

  it('treats anything unparseable as equal, so it can never produce a finding', () => {
    expect(compareVersions('dev', '2.40.99')).toBe(0);
    expect(compareVersions(null, '2.40.99')).toBe(0);
  });
});

describe('errors in the browser', () => {
  it('is one finding for one shape across several people', () => {
    const out = detectClientError([
      ev({ athlete_id: 'a1', message: 'Loading chunk 111aaa failed' }),
      ev({ athlete_id: 'a2', message: 'Loading chunk 222bbb failed' }),
      ev({ athlete_id: 'a3', message: 'Loading chunk 333ccc failed' }),
    ], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].affected).toBe(3);
    expect(out[0].strength).toBe('finding');
  });

  it('files one person on one phone as a weak signal, not as an alert', () => {
    const out = detectClientError([ev({ athlete_id: 'a1' }), ev({ athlete_id: 'a1' })], NOW);
    expect(out[0].affected).toBe(1);
    expect(out[0].strength).toBe('weak');
  });

  it('keys on the shape, so tonight refreshes last night instead of duplicating it', () => {
    const a = detectClientError([ev({ created_at: hoursAgo(40) }), ev({ athlete_id: 'a2' })], NOW);
    const b = detectClientError([ev({ athlete_id: 'a2' }), ev({ athlete_id: 'a3' })], NOW);
    expect(a[0].key).toBe(b[0].key);
  });

  it('ignores anything outside the window it reports on', () => {
    expect(detectClientError([ev({ created_at: hoursAgo(24 * 9) })], NOW)).toEqual([]);
  });

  it('never files an event with no athlete on it — a finding has to name people', () => {
    expect(detectClientError([ev({ athlete_id: null })], NOW)).toEqual([]);
  });
});

describe('a screen that loaded empty', () => {
  const blank = (over: Partial<ClientEventRow> = {}) => ev({ kind: 'blank', message: null, ...over });

  it('groups by screen, because a blank screen is a property of a screen', () => {
    const out = detectBlankScreen([
      blank({ athlete_id: 'a1', route: '/dashboard/plan' }),
      blank({ athlete_id: 'a2', route: '/dashboard/plan' }),
      blank({ athlete_id: 'a3', route: '/feed' }),
    ], NOW);
    expect(out).toHaveLength(2);
    const plan = out.find(f => f.key.endsWith('/dashboard/plan'))!;
    expect(plan.affected).toBe(2);
    expect(plan.strength).toBe('finding');
    expect(out.find(f => f.key.endsWith('/feed'))!.strength).toBe('weak');
  });

  it('says out loud what it cannot separate — somebody with no network', () => {
    const out = detectBlankScreen([blank({ athlete_id: 'a1' }), blank({ athlete_id: 'a2' })], NOW);
    expect(out[0].evidence.unknown).toBeTruthy();
  });
});

describe('a form somebody filled in and lost', () => {
  const drop = (id: string, route = '/dashboard/review') =>
    ev({ kind: 'form_abandon', athlete_id: id, route, message: null });

  it('stays quiet for one abandonment — leaving a form is a normal thing to do', () => {
    expect(detectDroppedForm([drop('a1')], NOW)).toEqual([]);
  });

  it('stays quiet when one person abandoned the same form three times', () => {
    // One person changing their mind repeatedly is still one person changing
    // their mind. The signal is several people failing at the same form.
    expect(detectDroppedForm([drop('a1'), drop('a1'), drop('a1')], NOW)).toEqual([]);
  });

  it('files it when the same form defeats several people', () => {
    const out = detectDroppedForm([drop('a1'), drop('a2'), drop('a2'), drop('a3')], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].affected).toBe(3);
  });

  it('carries no field values, only the fact that a form was left', () => {
    const out = detectDroppedForm([drop('a1'), drop('a2'), drop('a3')], NOW);
    expect(JSON.stringify(out[0])).not.toMatch(/value|password|email@/i);
  });
});

describe('a phone stuck on an old build', () => {
  const boot = (id: string, version: string, hours: number) =>
    ev({ kind: 'boot', athlete_id: id, message: version, app_version: version, created_at: hoursAgo(hours) });

  it('finds the phone that keeps opening the app and keeps not taking the update', () => {
    const out = detectStuckVersion([
      boot('a1', '2.40.90', 2), boot('a1', '2.40.90', 20), boot('a1', '2.40.90', 40),
      boot('a2', '2.40.90', 3), boot('a2', '2.40.90', 22), boot('a2', '2.40.90', 44),
      boot('fresh', '2.40.99', 1),
    ], '2.40.99', NOW);
    expect(out).toHaveLength(1);
    expect(out[0].affected).toBe(2);
    expect(out[0].evidence.athleteIds.sort()).toEqual(['a1', 'a2']);
  });

  it('gives one old boot the benefit of the doubt — right after a deploy everyone is behind', () => {
    const out = detectStuckVersion([boot('a1', '2.40.90', 2), boot('fresh', '2.40.99', 1)], '2.40.99', NOW);
    expect(out).toEqual([]);
  });

  it('forgets an athlete who has since taken the update', () => {
    const out = detectStuckVersion([
      boot('a1', '2.40.90', 30), boot('a1', '2.40.90', 40), boot('a1', '2.40.90', 50),
      boot('a1', '2.40.99', 1),
    ], '2.40.99', NOW);
    expect(out).toEqual([]);
  });

  it('compares against the newest build actually seen, not only the server\'s', () => {
    // A pass that runs mid-deploy must not report the whole club as stale.
    const out = detectStuckVersion([
      boot('a1', '2.41.5', 2), boot('a1', '2.41.5', 20), boot('a1', '2.41.5', 40),
    ], '2.40.99', NOW);
    expect(out).toEqual([]);
  });

  it('ignores a phone that stopped opening the app at all', () => {
    const out = detectStuckVersion([
      boot('a1', '2.40.90', 24 * 5), boot('a1', '2.40.90', 24 * 6), boot('a1', '2.40.90', 24 * 6.5),
    ], '2.40.99', NOW);
    expect(out).toEqual([]);
  });
});

describe('our own api answering 5xx', () => {
  const fail = (id: string, route: string) =>
    ev({ kind: 'api_error', athlete_id: id, route, message: '500' });

  it('groups by api path, which is the thing somebody can go and fix', () => {
    const out = detectServerError([
      fail('a1', '/api/athletes/x/stats'), fail('a2', '/api/athletes/x/stats'), fail('a3', '/api/feed'),
    ], NOW);
    expect(out.map(f => f.affected).sort()).toEqual([1, 2]);
    expect(out.some(f => f.key === 'server_error:/api/athletes/x/stats')).toBe(true);
  });

  it('is measured from the browser, and says so', () => {
    const out = detectServerError([fail('a1', '/api/feed'), fail('a2', '/api/feed')], NOW);
    expect(out[0].evidence.how).toContain('מהדפדפן');
  });

  it('never reports on its own endpoint, or a failing report reports itself', () => {
    expect(read('components/ClientEventReporter.tsx')).toMatch(/!p\.startsWith\('\/api\/client-events'\)/);
  });
});

describe('a run the data says is impossible', () => {
  const act = (over: Partial<ActivityRow> = {}): ActivityRow => ({
    id: 'r1', athlete_id: 'a1', start_time: hoursAgo(5),
    distance: 10_000, duration: 2700, has_polyline: true, source: 'strava', ...over,
  });

  it('flags a bike ride logged as a run', () => {
    // 40 km in an hour is 1:30/km. Not a fast athlete.
    const f = detectSuspiciousPace([act({ distance: 40_000, duration: 3600 })]);
    expect(f?.affected).toBe(1);
    expect(f?.title).toContain('1:30');
  });

  it('leaves the fastest people in the club completely alone', () => {
    // 3:00/km over 10 km is a very good athlete, and accusing them would be a
    // far worse failure than missing a bad row.
    expect(detectSuspiciousPace([act({ distance: 10_000, duration: 1800 })])).toBeNull();
  });

  it('ignores a short distance, where the pace is an artefact of rounding', () => {
    expect(detectSuspiciousPace([act({ distance: 400, duration: 50 })])).toBeNull();
  });

  it('flags a distance nobody ran in one activity', () => {
    const f = detectSuspiciousPace([act({ distance: 420_000, duration: 40_000 })]);
    expect(f?.title).toContain('420');
  });

  it('leaves a row with no numbers to the phantom detector', () => {
    expect(detectSuspiciousPace([act({ distance: null, duration: null })])).toBeNull();
  });

  it('counts people, not rows', () => {
    const f = detectSuspiciousPace([
      act({ id: 'r1', athlete_id: 'a1', distance: 40_000, duration: 3600 }),
      act({ id: 'r2', athlete_id: 'a1', distance: 40_000, duration: 3600 }),
    ]);
    expect(f?.affected).toBe(1);
    expect(f?.evidence.facts['פעילויות']).toBe(2);
  });
});

describe('not checked is not the same as found nothing', () => {
  it('has a rule written for every detector in the design', () => {
    expect(PENDING_DETECTORS).toEqual([]);
    expect(LIVE_DETECTORS).toHaveLength(11);
  });

  it('names the five that need the table, and leaves their state row alone', () => {
    expect(CLIENT_DETECTORS).toEqual([
      'client_error', 'blank_screen', 'dropped_form', 'stuck_version', 'server_error',
    ]);
    const run = read('lib/bugs/run.ts');
    // A missing table must not stamp tonight's date on a detector that never ran.
    expect(run).toMatch(/notChecked: DetectorKey\[\] = events \? \[\] : \[\.\.\.CLIENT_DETECTORS\]/);
    expect(run).toMatch(/LIVE_DETECTORS\.filter\(key => !notChecked\.includes\(key\)\)/);
    // And the distinction survives to the cron's own answer.
    expect(read('app/api/cron/detect/route.ts')).toMatch(/notChecked: result\.notChecked/);
  });

  it('tells a missing table apart from an empty one', () => {
    // `[]` would mean "checked, nothing there"; null means "there is no table".
    expect(read('lib/bugs/run.ts')).toMatch(/clientEvents: evs\.error \? null :/);
  });
});

describe('the reporter cannot be the bug', () => {
  const src = read('components/ClientEventReporter.tsx');

  it('never retries and never shows an athlete anything', () => {
    expect(src).not.toMatch(/setTimeout\(\(\) => flush\(\), *RETRY|retry/i);
    // Matched as CALLS, not as words: the component's own docblock says "no toast,
    // no banner, no console noise", and an assertion that a comment can satisfy —
    // or break — is not testing anything.
    expect(src).not.toMatch(/\balert\(|showToast\(|console\.(error|warn|log)\(/);
  });

  it('will not report an error thrown by its own handler', () => {
    expect(src).toMatch(/if \(inside \|\| disabled \|\| sent >= MAX_PER_PAGE\) return;/);
  });

  it('gives up for the page when there is no session, instead of a 401 loop', () => {
    expect(src).toMatch(/res\.status === 401 \|\| res\.status === 403\) disabled = true/);
  });

  it('strips the query string before anything is queued, not at the server', () => {
    expect(src).toMatch(/\.split\('\?'\)\[0\]/);
  });

  it('reads no form values — only that a form was abandoned', () => {
    expect(src).not.toMatch(/\.value\b/);
  });

  it('leaves the fetch it wrapped exactly as it found it', () => {
    expect(src).toMatch(/window\.fetch = realFetch;/);
  });
});

describe('the migration that makes the five possible', () => {
  const sql = read('../supabase/migrations/118_client_events.sql');

  it('stores only what a detector reads, and nothing about the device', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS client_events/);
    for (const col of ['athlete_id', 'kind', 'route', 'message', 'app_version', 'created_at']) {
      expect(sql, col).toContain(col);
    }
    // Read from the column list rather than the whole file: the prose above the DDL
    // says "no stack trace, no user agent", and matching those words in a comment
    // tests the comment. What matters is that no such COLUMN exists.
    const columns = sql.slice(sql.indexOf('CREATE TABLE'), sql.indexOf(');'));
    expect(columns).not.toMatch(/user_agent|stack|screen|device|ip_address/);
  });

  it('survives a second run, because it is applied by hand', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS client_events_created_idx/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS client_events_kind_created_idx/);
  });

  it('lets a departing member be deleted without failing on a debugging table', () => {
    expect(sql).toMatch(/REFERENCES athletes\(id\) ON DELETE SET NULL/);
  });

  it('does not keep events forever', () => {
    expect(sql).toMatch(/DELETE FROM client_events WHERE created_at < now\(\) - interval '30 days'/);
  });
});
