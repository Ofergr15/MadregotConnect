import { describe, it, expect } from 'vitest';
import {
  buildDispatchReport,
  slotKey,
  type DeliveryRow,
  type DispatchAthlete,
  type DispatchState,
} from '@/lib/academy/dispatch';

const TODAY = '2026-09-18';

const athlete = (over: Partial<DispatchAthlete> = {}): DispatchAthlete => ({
  id: 'a1',
  name: 'Dor Alon',
  connection: 'ok',
  ...over,
});

const delivery = (over: Partial<DeliveryRow> = {}): DeliveryRow => ({
  athlete_id: 'a1',
  workout_date: '2026-09-16',
  status: 'success',
  created_at: '2026-09-14T21:04:00.000Z',
  ...over,
});

/** The state of the one slot, for the common single-athlete single-day case. */
function stateOf(
  deliveries: DeliveryRow[],
  over: { athletes?: DispatchAthlete[]; activityDays?: string[]; today?: string } = {},
): DispatchState {
  const report = buildDispatchReport({
    athletes: over.athletes ?? [athlete()],
    deliveries,
    activityDays: new Set(over.activityDays ?? []),
    today: over.today ?? TODAY,
  });
  expect(report.rows).toHaveLength(1);
  return report.rows[0].state;
}

describe('buildDispatchReport — what we can honestly claim about a push', () => {
  it('only calls the watch proven when a run came back carrying the workout id', () => {
    expect(stateOf([delivery({ device_confirmed_at: '2026-09-16T06:20:00.000Z' })])).toBe('ran_from_it');
  });

  it('does not promote a verified push to "on the watch" — the account is all we know', () => {
    // The day is in the future, so there is no return trip to report yet. This is
    // the gap the mockup's "confirmed on watch, 21:06" column cannot cover.
    expect(stateOf([delivery({ workout_date: '2026-09-20' })])).toBe('on_account');
  });

  it('reports a failed push with Garmin\'s own words, never a paraphrase', () => {
    const report = buildDispatchReport({
      athletes: [athlete()],
      deliveries: [delivery({ status: 'failed', error_message: 'No Garmin auth token' })],
      activityDays: new Set(),
      today: TODAY,
    });
    expect(report.rows[0].state).toBe('send_failed');
    expect(report.rows[0].detail).toBe('No Garmin auth token');
  });

  it('says whose failure it is, because the two answers lead to opposite actions', () => {
    const blameOf = (error_message: string) =>
      buildDispatchReport({
        athletes: [athlete()],
        deliveries: [delivery({ status: 'failed', error_message })],
        activityDays: new Set(),
        today: TODAY,
      }).rows[0].blame;

    // Re-pushing this one will fail identically forever; the coach's job is a message to
    // the athlete, who has already been notified by the send path.
    expect(blameOf('No Garmin auth token')).toBe('reconnect');
    expect(blameOf('Request failed with status code 401')).toBe('reconnect');
    // And this one is just Garmin, so the answer is press the button again.
    expect(blameOf('Request failed with status code 503')).toBe('ours');
  });

  it('leaves blame null on every state that is not a send failure', () => {
    // A `pending` row has no error to classify, and claiming one would put a verdict on a
    // slot whose whole meaning is that nothing told us anything.
    const report = buildDispatchReport({
      athletes: [athlete()],
      deliveries: [delivery({ status: 'pending', garmin_workout_id: '99', error_message: '401' })],
      activityDays: new Set(),
      today: TODAY,
    });
    expect(report.rows[0].state).toBe('unconfirmed');
    expect(report.rows[0].blame).toBeNull();
  });

  it('keeps an unverified push separate from a failed one, and shows no error for it', () => {
    // `push-workouts` writes 'pending' when Garmin issued an id but the batch was
    // never read back. Nothing told us anything, so there is nothing to quote.
    const report = buildDispatchReport({
      athletes: [athlete()],
      deliveries: [delivery({ status: 'pending', garmin_workout_id: '99', error_message: 'ignored' })],
      activityDays: new Set(),
      today: TODAY,
    });
    expect(report.rows[0].state).toBe('unconfirmed');
    expect(report.rows[0].detail).toBeNull();
  });
});

describe('buildDispatchReport — the blind case, which must never read as a skipped session', () => {
  const past = { workout_date: '2026-09-16' };

  it('says "did not run" only when the athlete\'s runs are actually reaching us', () => {
    expect(stateOf([delivery(past)])).toBe('no_run');
  });

  it('refuses to judge an athlete whose credential the provider refused', () => {
    expect(stateOf([delivery(past)], { athletes: [athlete({ connection: 'failed' })] })).toBe('blind');
  });

  it('refuses to judge an athlete whose feed has gone quiet for a fortnight', () => {
    // A stale feed means we would not have seen the activity even if they ran the
    // session perfectly — so "no_run" here would accuse someone who ran.
    expect(stateOf([delivery(past)], { athletes: [athlete({ connection: 'stale' })] })).toBe('blind');
  });

  it('refuses to judge an athlete with no Garmin credential at all', () => {
    expect(stateOf([delivery(past)], { athletes: [athlete({ connection: 'none' })] })).toBe('blind');
  });

  it('treats the pre-migration-101 "unknown" as healthy, so a fresh deploy accuses nobody', () => {
    expect(stateOf([delivery(past)], { athletes: [athlete({ connection: 'unknown' })] })).toBe('no_run');
  });

  it('still trusts a confirmed run over a broken connection', () => {
    // The proof already arrived; losing the credential afterwards cannot un-run it.
    expect(
      stateOf([delivery({ ...past, device_confirmed_at: '2026-09-16T06:20:00.000Z' })], {
        athletes: [athlete({ connection: 'failed' })],
      }),
    ).toBe('ran_from_it');
  });

  it('stays blind even if an activity happens to be on file for that day', () => {
    // Guards the ORDER of the two checks. If the activity lookup ran first, an
    // athlete whose feed we cannot read would be reported `ran_freestyle` off data
    // we have no business trusting — a confident claim built on a broken pipe.
    expect(
      stateOf([delivery(past)], {
        athletes: [athlete({ connection: 'failed' })],
        activityDays: [slotKey('a1', '2026-09-16')],
      }),
    ).toBe('blind');
  });

  it('separates a freestyle run from a missed session', () => {
    expect(stateOf([delivery(past)], { activityDays: [slotKey('a1', '2026-09-16')] })).toBe('ran_freestyle');
  });

  it('does not let one athlete\'s run explain another\'s silence', () => {
    expect(stateOf([delivery(past)], { activityDays: [slotKey('a2', '2026-09-16')] })).toBe('no_run');
  });
});

describe('buildDispatchReport — several rows for one slot', () => {
  it('lets a later success outrank the failure it replaced', () => {
    // A re-push inserts a new row. Reporting the first attempt would send the coach
    // to re-push a workout that is already on the account.
    expect(stateOf([
      delivery({ status: 'failed', error_message: 'timeout' }),
      delivery({ status: 'success', created_at: '2026-09-14T21:40:00.000Z' }),
    ])).toBe('no_run');
  });

  it('does not let an earlier failure hide a proven run, whatever order the rows arrive in', () => {
    expect(stateOf([
      delivery({ device_confirmed_at: '2026-09-16T06:20:00.000Z' }),
      delivery({ status: 'failed', error_message: 'timeout' }),
    ])).toBe('ran_from_it');
    expect(stateOf([
      delivery({ status: 'failed', error_message: 'timeout' }),
      delivery({ device_confirmed_at: '2026-09-16T06:20:00.000Z' }),
    ])).toBe('ran_from_it');
  });

  it('reports the EARLIEST send, because that is when the watch could first have seen it', () => {
    const report = buildDispatchReport({
      athletes: [athlete()],
      deliveries: [
        delivery({ status: 'success', created_at: '2026-09-14T21:40:00.000Z' }),
        delivery({ status: 'failed', created_at: '2026-09-14T21:04:00.000Z' }),
      ],
      activityDays: new Set(),
      today: TODAY,
    });
    expect(report.rows[0].sentAt).toBe('2026-09-14T21:04:00.000Z');
  });

  it('ignores rows for an athlete who is not in scope', () => {
    const report = buildDispatchReport({
      athletes: [athlete()],
      deliveries: [delivery(), delivery({ athlete_id: 'someone-else' })],
      activityDays: new Set(),
      today: TODAY,
    });
    expect(report.rows.map(r => r.athleteId)).toEqual(['a1']);
  });
});

describe('buildDispatchReport — expected slots and ordering', () => {
  it('reports a day the plan asked for and nobody pushed', () => {
    const report = buildDispatchReport({
      athletes: [athlete()],
      deliveries: [],
      activityDays: new Set(),
      expected: new Map([['a1', ['2026-09-16']]]),
      today: TODAY,
    });
    expect(report.rows[0].state).toBe('not_sent');
    expect(report.rows[0].sentAt).toBeNull();
  });

  it('does not invent a gap for a slot nobody asked for and nobody pushed', () => {
    const report = buildDispatchReport({
      athletes: [athlete()],
      deliveries: [],
      activityDays: new Set(),
      today: TODAY,
    });
    expect(report.rows).toEqual([]);
  });

  it('puts what the coach must act on first, worst first', () => {
    const report = buildDispatchReport({
      athletes: [
        athlete({ id: 'ok', name: 'Noa' }),
        athlete({ id: 'pend', name: 'Avi' }),
        athlete({ id: 'fail', name: 'Uri' }),
        athlete({ id: 'gone', name: 'Tal', connection: 'failed' }),
      ],
      deliveries: [
        delivery({ athlete_id: 'ok', device_confirmed_at: '2026-09-16T06:20:00.000Z' }),
        delivery({ athlete_id: 'pend', status: 'pending' }),
        delivery({ athlete_id: 'fail', status: 'failed', error_message: 'No Garmin auth token' }),
        delivery({ athlete_id: 'gone' }),
      ],
      activityDays: new Set(),
      today: TODAY,
    });
    expect(report.rows.map(r => r.state)).toEqual(['send_failed', 'unconfirmed', 'blind', 'ran_from_it']);
    expect(report.needsAttention.map(r => r.name)).toEqual(['Uri', 'Avi', 'Tal']);
  });

  it('keeps the two "nothing is on that watch" states adjacent, ahead of the milder ones', () => {
    // `send_failed` and `not_sent` mean the same thing to the athlete and wear the
    // same red. Ordering them apart put two red rows either side of two calm ones,
    // which reads as three separate problems rather than one severity-ordered list.
    const report = buildDispatchReport({
      athletes: [
        athlete({ id: 'fail', name: 'Uri' }),
        athlete({ id: 'pend', name: 'Avi' }),
        athlete({ id: 'gone', name: 'Tal', connection: 'failed' }),
        athlete({ id: 'never', name: 'Noa' }),
      ],
      deliveries: [
        delivery({ athlete_id: 'fail', status: 'failed', error_message: 'x' }),
        delivery({ athlete_id: 'pend', status: 'pending' }),
        delivery({ athlete_id: 'gone' }),
      ],
      activityDays: new Set(),
      expected: new Map([['never', ['2026-09-16']]]),
      today: TODAY,
    });
    expect(report.rows.map(r => r.state)).toEqual(['send_failed', 'not_sent', 'unconfirmed', 'blind']);
  });

  it('counts the KPI as exactly the people the red box names', () => {
    // The screen prints `summary.unconfirmed` above a sentence listing
    // `needsAttention` minus the blind rows. Those two must be the same set, or the
    // header says 2 while the sentence names 3 — which is what shipped first.
    const report = buildDispatchReport({
      athletes: [
        athlete({ id: 'fail', name: 'Uri' }),
        athlete({ id: 'pend', name: 'Avi' }),
        athlete({ id: 'never', name: 'Noa' }),
        athlete({ id: 'gone', name: 'Tal', connection: 'failed' }),
      ],
      deliveries: [
        delivery({ athlete_id: 'fail', status: 'failed', error_message: 'x' }),
        delivery({ athlete_id: 'pend', status: 'pending' }),
        delivery({ athlete_id: 'gone' }),
      ],
      activityDays: new Set(),
      expected: new Map([['never', ['2026-09-16']]]),
      today: TODAY,
    });
    const named = report.needsAttention.filter(r => r.state !== 'blind');
    expect(report.summary.unconfirmed).toBe(named.length);
    expect(report.summary.unconfirmed).toBe(3);
  });

  it('never asks the coach to act on a freestyle run or a quiet day', () => {
    // Both are real information and neither is fixable from this screen. A screen
    // that alarms on every freestyle long run is a screen nobody opens twice.
    const report = buildDispatchReport({
      athletes: [athlete({ id: 'a1', name: 'Dor' }), athlete({ id: 'a2', name: 'Noa' })],
      deliveries: [delivery({ athlete_id: 'a1' }), delivery({ athlete_id: 'a2' })],
      activityDays: new Set([slotKey('a1', '2026-09-16')]),
      today: TODAY,
    });
    expect(report.rows.map(r => r.state).sort()).toEqual(['no_run', 'ran_freestyle']);
    expect(report.needsAttention).toEqual([]);
  });

  it('counts the summary the way the screen reads it', () => {
    const report = buildDispatchReport({
      athletes: [
        athlete({ id: 'a1', name: 'A' }),
        athlete({ id: 'a2', name: 'B' }),
        athlete({ id: 'a3', name: 'C' }),
        athlete({ id: 'a4', name: 'D', connection: 'failed' }),
      ],
      deliveries: [
        delivery({ athlete_id: 'a1', device_confirmed_at: '2026-09-16T06:20:00.000Z' }),
        delivery({ athlete_id: 'a2' }),
        delivery({ athlete_id: 'a3', status: 'failed', error_message: 'x' }),
        delivery({ athlete_id: 'a4' }),
      ],
      activityDays: new Set(),
      today: TODAY,
    });
    // Three pushes landed on the account; one of them is proven on a device; the
    // failed push is not on the account and is the only delivery problem.
    expect(report.summary).toEqual({ onAccount: 3, ranFromIt: 1, unconfirmed: 1, blind: 1 });
  });

  it('a date on today is still the future — the club is not in UTC', () => {
    expect(stateOf([delivery({ workout_date: TODAY })])).toBe('on_account');
  });
});
