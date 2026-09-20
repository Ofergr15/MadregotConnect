import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { paceGroupKeyFor, paceGroupMap } from '@/lib/plans/pace-group';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * bc77a4a2 + c1334a75 — "let an athlete see whether the workout is on their watch,
 * and push it in one tap if it isn't" and "from 20:00 show the NEXT workout with
 * that state beside it". One feature from two angles.
 *
 * The thing worth pinning is not the layout. It is that this is the only route in
 * the app where a non-staff caller causes a write to a real Garmin account, and
 * that the answer it gives is never stronger than what Garmin confirmed.
 */

describe('which pace variant is mine', () => {
  // The plan stores group1/2/3 — the same week at three paces. Nothing in the
  // database says which club group is which; the rule was implicit in the
  // planner's UI until the self-push needed to reach the same answer. Off by one
  // index here means the wrong paces on a real person's watch.
  const groups = [
    { id: 'mid', marathonGoal: 'SUB 3:30' },
    { id: 'fast', marathonGoal: 'SUB 3:00' },
    { id: 'slow', marathonGoal: 'SUB 4:15' },
  ];

  it('gives slot 1 to the fastest group', () => {
    expect(paceGroupMap(groups)).toEqual({ fast: 'group1', mid: 'group2', slow: 'group3' });
  });

  it('reads the real production format, which is prose around a clock time', () => {
    // The three live groups are "SUB 2:30" / "SUB 2:35" / "SUB 2:45". The old
    // planner comparator was parseFloat(), which is NaN on every one of them —
    // so the sort did nothing and the mapping was really just row order. This is
    // the case that has to keep working.
    expect(paceGroupMap([
      { id: 'c', marathonGoal: 'SUB 2:45' },
      { id: 'a', marathonGoal: 'SUB 2:30' },
      { id: 'b', marathonGoal: 'SUB 2:35' },
    ])).toEqual({ a: 'group1', b: 'group2', c: 'group3' });
  });

  it('does not collapse two goals that share an hour', () => {
    // parseFloat('3:30') is 3, same as parseFloat('3:00') — the minutes were
    // being thrown away, which is how two groups could tie and fall back to
    // whatever order the rows arrived in.
    expect(paceGroupMap([
      { id: 'slower', marathonGoal: '3:30' },
      { id: 'faster', marathonGoal: '3:00' },
    ])).toEqual({ faster: 'group1', slower: 'group2' });
  });

  it('sorts a group with no readable goal behind every real time', () => {
    const map = paceGroupMap([{ id: 'unset', marathonGoal: '' }, { id: 'fast', marathonGoal: '3:00' }]);
    expect(map).toEqual({ fast: 'group1', unset: 'group2' });
    const junk = paceGroupMap([{ id: 'junk', marathonGoal: 'fast!' }, { id: 'real', marathonGoal: '4:00' }]);
    expect(junk).toEqual({ real: 'group1', junk: 'group2' });
  });

  it('shares the third slot among every group past the third', () => {
    const many = [2, 3, 4, 5, 6].map((n) => ({ id: `g${n}`, marathonGoal: `${n}:00` }));
    expect(paceGroupMap(many).g4).toBe('group3');
    expect(paceGroupMap(many).g6).toBe('group3');
  });

  it('puts an athlete with no group in the middle, not the fastest', () => {
    // The consequence of guessing wrong is paces on a watch, so the default is
    // the one that is wrong by the least — never group1.
    expect(paceGroupKeyFor(groups, null)).toBe('group2');
    expect(paceGroupKeyFor(groups, 'unknown-group')).toBe('group2');
    expect(paceGroupKeyFor(groups, 'fast')).toBe('group1');
  });

  it('is the only copy of the rule — the planner reads it too', () => {
    const planner = read('app/(app)/dashboard/plan/new/page.tsx');
    expect(planner).toMatch(/paceGroupMap\(groups\)/);
    // The group list the coach reads is labelled off this same ordering, so it
    // reads the shared sort too rather than repeating the comparator.
    expect(planner).toMatch(/sortByPaceGroup\(groups\)/);
    // Both inline copies of the rule, which is what a second answer would drift from.
    expect(planner).not.toMatch(/parseFloat\(a\.marathonGoal\)/);
    expect(planner).not.toMatch(/const aGoal =/);
  });
});

describe('/api/my-watch scope', () => {
  const route = read('app/api/my-watch/route.ts');

  it('takes the athlete from the session and from nowhere else', () => {
    // This route writes training onto a Garmin account, so an id in the body or
    // the query string would be a way to push workouts onto somebody else.
    expect(route).toMatch(/requireAthlete\(request\)/);
    expect(route).toMatch(/auth\.user\.athleteId/);
    expect(route).not.toMatch(/req(uest)?\.json\(\)/);
    expect(route).not.toMatch(/searchParams/);
  });

  it('never serialises the Garmin credential', () => {
    // Encrypted at rest; `garminConnected` is a boolean and stays one.
    expect(route).toMatch(/garminConnected: boolean/);
    expect(route).toMatch(/!!athlete\?\.garmin_auth/);
    // The response shape is declared in this file; if the credential ever got
    // added to it, it would have to be added here.
    const shape = route.match(/interface WatchState \{[\s\S]*?\n\}/);
    expect(shape).not.toBeNull();
    expect(shape![0]).not.toMatch(/garmin_auth/);
  });

  it('claims only what Garmin confirmed', () => {
    // 'pending' means a push started and was never verified. Telling somebody
    // their session is on their watch when it might not be is the exact failure
    // this feature exists to prevent — so the read filters on 'success' and the
    // route never selects any other status.
    expect(route).toMatch(/\.eq\('status', 'success'\)/);
    expect(route).not.toMatch(/\.in\('status'/);
  });

  it('reads the state back after pushing instead of assuming a 200 landed', () => {
    const pushAt = route.indexOf('await pushWeekToAthlete(');
    const readBackAt = route.lastIndexOf('await readWatchState(');
    expect(pushAt).toBeGreaterThan(-1);
    expect(readBackAt).toBeGreaterThan(pushAt);
  });

  it('does not let a self-push grant itself pace-zone alarms', () => {
    // Academy-only and coach-toggleable, both checked server-side — the client
    // has no field it could send to turn alerting on.
    expect(route).toMatch(/is_academy\b[\s\S]{0,40}&& paceAlerts/);
  });

  it('stays silent to the person who just tapped the button', () => {
    expect(route).toMatch(/notify: false/);
  });
});

describe('one delivery implementation, two callers', () => {
  it('the coach route and the athlete route push through the same function', () => {
    expect(read('app/api/garmin/push-workouts/route.ts')).toMatch(/pushWeekToAthlete\(\{/);
    expect(read('app/api/my-watch/route.ts')).toMatch(/pushWeekToAthlete\(\{/);
  });

  it('keeps the verification that makes "success" mean something', () => {
    const lib = read('lib/garmin/push-week.ts');
    // A read-back off the account, and the promotion to 'success' only after it.
    const verifyAt = lib.indexOf('verifyWorkoutOnAccount(');
    const promoteAt = lib.indexOf(".update({ status: 'success' })");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(promoteAt).toBeGreaterThan(verifyAt);
    // And the rows go in as 'pending' first, before Garmin has been asked.
    expect(lib.indexOf("status: 'pending',")).toBeLessThan(verifyAt);
  });

  it('never creates a Garmin workout without an id Garmin issued', () => {
    // The hole this whole area was rebuilt around: createWorkout used to return
    // '' for a response with no id, and the empty push read as a success.
    expect(read('lib/garmin/push-week.ts')).toMatch(/await garmin\.createWorkout\(/);
    expect(read('lib/garmin/delivery.ts')).toMatch(/returned no workout id/);
  });
});

describe('the evening turnover', () => {
  const page = read('app/(app)/dashboard/page.tsx');

  it('flips the hero to tomorrow from 20:00 Israel', () => {
    expect(page).toMatch(/EVENING_LOOKAHEAD_HOUR = 20/);
    expect(page).toMatch(/israelNow\(\)\.hour >= EVENING_LOOKAHEAD_HOUR/);
  });

  it('stops today from winning the card all evening just because it was skipped', () => {
    // The whole point of the gate: the old condition was `todayW && !todayDone`,
    // so anybody who ran short was shown today's session until midnight.
    expect(page).toMatch(/!todayDone && !eveningAnchor/);
  });

  it('asks about the date the card is actually showing', () => {
    expect(page).toMatch(/<WatchStatus date=\{toISODate\(heroWorkout\.nextDate\)\} \/>/);
  });
});

describe('the row itself', () => {
  const component = read('components/WatchStatus.tsx');

  it('renders nothing until the answer is known', () => {
    // A row that says "not on your watch" for the second before the fetch lands
    // gets read, tapped, and re-pushes a week that was already there.
    expect(component).toMatch(/if \(!data \|\| !data\.garminConnected \|\| !data\.hasPlan\) return null/);
  });

  it('keeps the card presentational', () => {
    // NextWorkoutCard takes the row as a node; it does no fetching of its own.
    const card = read('components/NextWorkoutCard.tsx');
    expect(card).toMatch(/watch\?: React\.ReactNode/);
    expect(card).not.toMatch(/my-watch/);
  });

  it('is translated in both catalogues', () => {
    const he = JSON.parse(readFileSync(join(SRC, '../messages/he.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(SRC, '../messages/en.json'), 'utf8'));
    expect(Object.keys(he.watchStatus).sort()).toEqual(Object.keys(en.watchStatus).sort());
    expect(he.watchStatus.sendToWatch).toBeTruthy();
  });
});
