import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

/**
 * dispatchMorningReminders — the cron tick's morning push (trainee-experience-v2 screen 9).
 *
 * What only the server can get wrong: reading the trainee's OWN plan row (never another
 * trainee's), the ledger (a second tick sends nothing), the watch, today's runs, and the
 * night it fetches when the sweep has not reached it — and staying quiet on a rest day,
 * after a run, when 'workouts' is muted, or when the reminder was never switched on.
 */

const TODAY = '2026-10-13';           // a Tuesday
const WEEK = '2026-10-11';
const SIX_AM = '2026-10-13T03:00:00Z'; // 06:00 in Israel (IDT, +03:00)
const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const notifyAthlete = vi.fn(async (_opts: any) => {});
let subscriptions = 1;
vi.mock('@/lib/push', () => ({
  notifyAthlete: async (o: any) => { await notifyAthlete(o); return { subscriptions, delivered: subscriptions }; },
  subscriptionsForAthletes: async () => Array.from({ length: subscriptions }, () => ({})),
}));
const fetchNight = vi.fn(async (..._a: unknown[]) => null as null | { sleep_seconds: number | null; resting_hr: number | null });
vi.mock('@/lib/wellness/sweep', () => ({ fetchNight: (...a: unknown[]) => fetchNight(...a) }));

const { dispatchMorningReminders, LEDGER_KIND, ranBefore, reminderTag } = await import('@/lib/academy/morning-reminder-server');

const SHAHAR = uid();
const DANA = uid();
const GROUP = uid();

const SCHEMA: Record<string, string[]> = {
  athletes: ['id', 'coach_id', 'name', 'role', 'status', 'group_id', 'is_academy', 'notification_prefs', 'garmin_auth'],
  groups: ['id', 'name', 'coach_id'],
  weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'status', 'created_at'],
  workout_deliveries: ['athlete_id', 'workout_date', 'status', 'plan_id'],
  scheduled_notifications: ['id', 'kind', 'title_he', 'body_he', 'audience_type', 'audience_id', 'schedule_type', 'status', 'last_sent_at', 'sent_count', 'url'],
  athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits', 'source'],
  athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr', 'fetched_at'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
};

const pace = (sec: number) => ({ targetType: 'pace', targetPaceMinPerKm: sec, targetPaceMaxPerKm: sec });
const run = (order: number, type: string, metres: number, sec: number) => ({ order, type, durationType: 'distance', durationValue: metres, ...pace(sec) });
const reps = (order: number, count: number, metres: number, sec: number) => ({
  order, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: count,
  repeatSteps: [
    { order: 1, type: 'interval', durationType: 'distance', durationValue: metres, ...pace(sec) },
    { order: 2, type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' },
  ],
});
const FIVE_BY_ONE = { dayOfWeek: 2, name: 'חזרות', steps: [run(1, 'warmup', 2000, 340), reps(2, 5, 1000, 245), run(3, 'cooldown', 2000, 340)] };
const EASY = { dayOfWeek: 2, name: 'ריצה קלה', steps: [run(1, 'run', 12000, 360)] };

let db: ReturnType<typeof createMemoryDb>;

function plan(athleteId: string | null, workouts: unknown[]) {
  db.tables.weekly_plans.push({
    id: uid(), coach_id: COACH_ID, athlete_id: athleteId, week_start_date: WEEK,
    parsed_workouts: { workouts }, status: 'pushed', created_at: '2026-10-10T10:00:00Z',
  });
}

const ON = { morningReminder: { enabled: true, time: '06:00' } };

function seed(opts: { prefs?: unknown } = {}) {
  db = createMemoryDb({ schema: SCHEMA, defaults: { scheduled_notifications: () => ({ id: uid() }) } });
  db.tables.groups.push({ id: GROUP, name: 'Group B 2:30-2:45', coach_id: COACH_ID });
  db.tables.athletes.push(
    { id: SHAHAR, coach_id: COACH_ID, name: 'Shahar', role: 'runner', status: 'active', group_id: GROUP, is_academy: true, notification_prefs: 'prefs' in opts ? opts.prefs : ON, garmin_auth: null },
    { id: DANA, coach_id: COACH_ID, name: 'Dana', role: 'runner', status: 'active', group_id: GROUP, is_academy: true, notification_prefs: null, garmin_auth: null },
  );
  db.tables.academy_tests.push({ id: uid(), athlete_id: SHAHAR, test_date: '2026-09-16', protocol: '30min', duration_sec: 1800, distance_m: 7143, excluded_reason: null, status: 'approved' });
  // 29 mornings 46–50, so this morning's 51 reads "קצת גבוה".
  for (let i = 1; i <= 29; i += 1) {
    db.tables.athlete_wellness.push({ athlete_id: SHAHAR, date: day(-i), sleep_seconds: 26000, resting_hr: 46 + (i % 5) });
  }
  db.tables.workout_deliveries.push({ athlete_id: SHAHAR, workout_date: TODAY, status: 'success' });
}

beforeEach(() => {
  notifyAthlete.mockClear();
  fetchNight.mockReset();
  fetchNight.mockResolvedValue(null);
});

describe('dispatchMorningReminders', () => {
  it('the reminder is on but no device can receive a push: skipped as noSubscription, not sent, no ledger (issue 22)', async () => {
    seed();
    plan(SHAHAR, [FIVE_BY_ONE]);
    subscriptions = 0;
    try {
      const r = await dispatchMorningReminders(db.client as never, SIX_AM);
      expect(r.sent).toBe(0);
      expect(r.skipped.noSubscription).toBe(1);
      expect(notifyAthlete).not.toHaveBeenCalled();
      expect(db.tables.scheduled_notifications.filter(n => n.kind === LEDGER_KIND)).toHaveLength(0);
    } finally {
      subscriptions = 1;
    }
  });

  it('06:00 on a workout day: exactly one push, with screen 9\'s lines, and a ledger row', async () => {
    seed();
    plan(SHAHAR, [FIVE_BY_ONE]);
    db.tables.athlete_wellness.push({ athlete_id: SHAHAR, date: TODAY, sleep_seconds: 26000, resting_hr: 51 });

    const r = await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(r.sent).toBe(1);
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    const opts = notifyAthlete.mock.calls[0][0];
    expect(opts).toMatchObject({
      athleteId: SHAHAR, kind: 'academy_morning', category: 'workouts',
      tag: `academy-day-${SHAHAR}-${TODAY}`, url: `/dashboard/academy?open=${TODAY}`,
    });
    const plain = (s: string) => s.replace(/[⁦-⁩]/g, '');
    const he = opts.copy('he');
    expect(plain(he.title)).toBe('היום: 5 × 1 ק״מ ב־4:05');
    expect(plain(he.body).split('\n')[0]).toMatch(/^10(\.\d)? ק״מ · כ־\d+ דק׳ · ⌚ נשלח ל־Garmin$/);
    expect(plain(he.body).split('\n')[1]).toBe('הדופק קצת גבוה הבוקר. אם החזרות כבדות, מותר לעצור ב־4.');

    const ledger = db.tables.scheduled_notifications.filter(n => n.kind === LEDGER_KIND);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].url).toBe(`#ledger:academy-morning:${SHAHAR}:${TODAY}`);
    // The night was stored: nothing had to be fetched.
    expect(fetchNight).not.toHaveBeenCalled();

    // A second tick inside the window sends nothing.
    const again = await dispatchMorningReminders(db.client as never, '2026-10-13T03:05:00Z');
    expect(again.sent).toBe(0);
    expect(again.skipped.sent).toBe(1);
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
  });

  it('reads the trainee\'s own row, never another trainee\'s', async () => {
    seed();
    plan(DANA, [FIVE_BY_ONE]);   // Dana's personal week
    plan(null, [EASY]);          // the club's
    await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    expect(notifyAthlete.mock.calls[0][0].copy('he').title.replace(/[⁦-⁩]/g, '')).toMatch(/^היום: /);
    expect(notifyAthlete.mock.calls[0][0].copy('he').title).not.toContain('5 × 1');
  });

  it('fetches a night the sweep has not reached, and drops line 3 when that fails', async () => {
    seed();
    plan(SHAHAR, [FIVE_BY_ONE]);
    await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(fetchNight).toHaveBeenCalledWith(expect.anything(), SHAHAR, TODAY, { timeoutMs: 3000 });
    expect(notifyAthlete.mock.calls[0][0].copy('he').body).not.toContain('\n');
  });

  it('uses a fetched night for line 3', async () => {
    seed();
    plan(SHAHAR, [FIVE_BY_ONE]);
    fetchNight.mockResolvedValue({ sleep_seconds: 26000, resting_hr: 58 });
    await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(notifyAthlete.mock.calls[0][0].copy('he').body).toContain('הדופק גבוה הבוקר');
  });

  it('no push on a rest day', async () => {
    seed();
    plan(SHAHAR, [{ ...FIVE_BY_ONE, dayOfWeek: 3 }]);
    const r = await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(notifyAthlete).not.toHaveBeenCalled();
    expect(r.skipped.noWorkout).toBe(1);
  });

  it('no push without a plan for the week', async () => {
    seed();
    const r = await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(notifyAthlete).not.toHaveBeenCalled();
    expect(r.skipped.noPlan).toBe(1);
  });

  it('no push after a run already done this morning', async () => {
    seed();
    plan(SHAHAR, [FIVE_BY_ONE]);
    db.tables.athlete_activities.push({ id: uid(), athlete_id: SHAHAR, start_time: '2026-10-13T02:30:00Z', activity_type: 'running', distance: 10000, duration: 3000 });
    const r = await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(notifyAthlete).not.toHaveBeenCalled();
    expect(r.skipped.alreadyRan).toBe(1);
  });

  it('no push after a 05:30 run for a 06:00 reminder: start_time is the watch\'s wall clock, not an instant', async () => {
    seed();
    plan(SHAHAR, [FIVE_BY_ONE]);
    // 05:30 local, stored as if UTC (the real instant was 02:30Z).
    db.tables.athlete_activities.push({ id: uid(), athlete_id: SHAHAR, start_time: '2026-10-13T05:30:00+00:00', activity_type: 'running', distance: 10000, duration: 3000 });
    const r = await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(notifyAthlete).not.toHaveBeenCalled();
    expect(r.skipped.alreadyRan).toBe(1);
  });

  it('ranBefore compares the wall clock with the send minute', () => {
    expect(ranBefore('2026-10-13T05:30:00+00:00', TODAY, 6 * 60)).toBe(true);
    expect(ranBefore('2026-10-13T06:30:00', TODAY, 6 * 60)).toBe(false);
    expect(ranBefore('2026-10-12T05:30:00+00:00', TODAY, 6 * 60)).toBe(false);
  });

  it('after the coach\'s own watch push for the day, the reminder takes its tag (one notification)', async () => {
    seed();
    plan(SHAHAR, [FIVE_BY_ONE]);
    db.tables.workout_deliveries[0].plan_id = 'plan-1';
    db.tables.scheduled_notifications.push({ id: uid(), kind: 'plan_pushed', audience_type: 'athlete', audience_id: SHAHAR, schedule_type: 'now', status: 'sent', last_sent_at: '2026-10-12T19:00:00Z', sent_count: 1, url: '/dashboard/program' });
    await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    expect(notifyAthlete.mock.calls[0][0].tag).toBe('plan-push-plan-1');
  });

  it('reminderTag: its own per-day tag unless the coach pushed in the last day', () => {
    expect(reminderTag({ athleteId: 'a', workoutDate: TODAY, coachPushed: false, delivery: { plan_id: 'p' } })).toBe(`academy-day-a-${TODAY}`);
    expect(reminderTag({ athleteId: 'a', workoutDate: TODAY, coachPushed: true, delivery: null })).toBe(`academy-day-a-${TODAY}`);
    expect(reminderTag({ athleteId: 'a', workoutDate: TODAY, coachPushed: true, delivery: { plan_id: null } })).toBe(`plan-push-${WEEK}`);
  });

  it('no push when the workouts category is muted', async () => {
    seed({ prefs: { ...ON, workouts: false } });
    plan(SHAHAR, [FIVE_BY_ONE]);
    const r = await dispatchMorningReminders(db.client as never, SIX_AM);
    expect(notifyAthlete).not.toHaveBeenCalled();
    expect(r.skipped.muted).toBe(1);
  });

  it('nobody gets it unless they switched it on (TRAINEE_V2_FOR_ALL is off), and not before the time', async () => {
    seed({ prefs: null });
    plan(SHAHAR, [FIVE_BY_ONE]);
    expect((await dispatchMorningReminders(db.client as never, SIX_AM)).sent).toBe(0);
    seed();
    plan(SHAHAR, [FIVE_BY_ONE]);
    expect((await dispatchMorningReminders(db.client as never, '2026-10-13T02:55:00Z')).sent).toBe(0);
    expect(notifyAthlete).not.toHaveBeenCalled();
  });

  it('never throws: a broken read is a quiet morning', async () => {
    db = createMemoryDb({ schema: { groups: ['id'] } });
    await expect(dispatchMorningReminders(db.client as never, SIX_AM)).resolves.toMatchObject({ sent: 0 });
  });
});
