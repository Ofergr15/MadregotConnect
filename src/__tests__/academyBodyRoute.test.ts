import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * GET /api/academy/body — resting HR, sleep and feel against the trainee's own range
 * (trainee-experience-v2 screen 8).
 *
 * Health data, so WHO may read it is the point: the trainee, their coach, nobody else.
 * Then the shape, and that a database without the wellness table still answers.
 */

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-13T12:10:00+03:00'));
afterAll(() => { vi.useRealTimers(); });

const TODAY = '2026-10-13';
const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const TRAINEE = uid();
const COACH = uid();
const STRANGER = uid();

const requireCallerForAthlete = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: (r: Request, id: string) => requireCallerForAthlete(r, id),
}));
vi.mock('@/lib/academy/pairing-server', () => ({
  mayCoach: async (c: { athleteId: string }, id: string) => c.athleteId === id || (c.athleteId === COACH && id === TRAINEE),
}));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { GET } = await import('@/app/api/academy/body/route');
const get = (q: string) => GET(new Request(`http://x/api/academy/body?${q}`));
const as = (athleteId: string) => requireCallerForAthlete.mockResolvedValue({ denied: null, caller: { athleteId, isStaff: athleteId === COACH } });

const MOCK = [47, 48, 46, 45, 51, 49, 47, 46, 44, 48, 50, 52, 47, 46, 45, 48, 51, 46, 47, 45, 50, 44, 52, 48, 46, 51, 49, 50, 48, 51];

function seed(withWellness = true) {
  db = createMemoryDb({
    schema: {
      ...(withWellness ? { athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr'] } : {}),
      workout_feedback: ['id', 'athlete_id', 'garmin_activity_id', 'feel', 'difficulty', 'created_at'],
      athlete_activities: ['id', 'athlete_id', 'garmin_activity_id', 'start_time'],
    },
  });
  if (withWellness) {
    MOCK.forEach((v, i) => db.tables.athlete_wellness.push({ athlete_id: TRAINEE, date: day(i - 29), resting_hr: v, sleep_seconds: 25200 + (i % 5) * 900 }));
    // Somebody else's mornings never leak in.
    db.tables.athlete_wellness.push({ athlete_id: STRANGER, date: TODAY, resting_hr: 90, sleep_seconds: 1000 });
  }
  [3, 3, 4, 2].forEach((feel, i) => db.tables.workout_feedback.push({ id: uid(), athlete_id: TRAINEE, feel, difficulty: i % 2 ? 6 : 7, created_at: `${day(-1 - 2 * i)}T08:00:00Z` }));
}

beforeEach(() => { seed(); as(TRAINEE); });

describe('GET /api/academy/body', () => {
  it('needs an athlete', async () => {
    expect((await get('')).status).toBe(400);
  });

  it('a stranger gets 403', async () => {
    as(STRANGER);
    expect((await get(`athleteId=${TRAINEE}`)).status).toBe(403);
  });

  it('the trainee and their coach get the body screen', async () => {
    for (const who of [TRAINEE, COACH]) {
      as(who);
      const res = await get(`athleteId=${TRAINEE}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.today).toBe(TODAY);
      expect(body.rhr).toMatchObject({ latest: { date: TODAY, value: 51 }, isToday: true, verdict: 'bitHigh', advice: 'once' });
      expect(body.rhr.range).toMatchObject({ lo: 46, hi: 50 });
      expect(body.rhr.series).toHaveLength(30);
      expect(body.sleep.latest.date).toBe(TODAY);
      expect(body.feel).toMatchObject({ face: 3, effort: 6.5, n: 4 });
      expect(body.featured).toBe('rhr');
    }
  });

  it('an answer is dated by its run, not by the day it was typed', async () => {
    seed();
    db.tables.workout_feedback.length = 0;
    // Two runs, both answered on the evening of the first one's day (lab: 11.10 and 12.10).
    db.tables.athlete_activities.push(
      { id: uid(), athlete_id: TRAINEE, garmin_activity_id: 11, start_time: `${day(-2)}T18:30:00+00:00` },
      { id: uid(), athlete_id: TRAINEE, garmin_activity_id: 12, start_time: `${day(-1)}T06:30:00+00:00` },
    );
    db.tables.workout_feedback.push(
      { id: uid(), athlete_id: TRAINEE, garmin_activity_id: 11, feel: 3, difficulty: 6, created_at: `${day(-2)}T19:00:00Z` },
      { id: uid(), athlete_id: TRAINEE, garmin_activity_id: 12, feel: 4, difficulty: 7, created_at: `${day(-2)}T19:05:00Z` },
    );
    const body = await (await get(`athleteId=${TRAINEE}`)).json();
    expect(body.feel.recent.map((r: { date: string }) => r.date)).toEqual([day(-2), day(-1)]);
  });

  it('before the wellness table: an answer, with nothing to show yet', async () => {
    seed(false);
    const res = await get(`athleteId=${TRAINEE}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rhr.latest).toBeNull();
    expect(body.rhr.series).toEqual([]);
    expect(body.featured).toBe('feel');
  });
});
