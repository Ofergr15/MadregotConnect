import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * POST /api/workout-feedback — screen 6's pain switch says "אם כן, Rina מקבלת התראה", so a
 * pain report reaches the trainee's OWN academy coaches (not only the club's staff), and a
 * re-save of the same answer alerts nobody a second time.
 */

const TRAINEE = uid();
const RINA = uid();
const OTHER = uid();

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: async () => ({ denied: null, caller: { athleteId: TRAINEE } }),
  requireStaffCaller: async () => ({ denied: null }),
}));
const notifyStaff = vi.fn(async (_o: unknown) => {});
const MANAGER = uid();
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: (o: unknown) => notifyStaff(o), academyManagerIds: async () => [MANAGER] }));
const notifyAthlete = vi.fn(async (_o: any) => {});
vi.mock('@/lib/push', () => ({ notifyAthlete: (o: unknown) => notifyAthlete(o) }));
let coachesOf: string[] = [RINA];
vi.mock('@/lib/academy/trainee-coaches', () => ({ coachIdsOf: async () => coachesOf }));

const { POST } = await import('@/app/api/workout-feedback/route');
const post = (body: Record<string, unknown>) => POST(new Request('http://x/api/workout-feedback', {
  method: 'POST', body: JSON.stringify({ athleteId: TRAINEE, activityId: 777, ...body }),
}));

beforeEach(() => {
  db = createMemoryDb({
    schema: {
      workout_feedback: ['id', 'athlete_id', 'garmin_activity_id', 'difficulty', 'feel', 'pain', 'pain_detail', 'wants_feedback', 'comment'],
      athletes: ['id', 'name', 'avatar_url'],
      athlete_activities: ['id', 'athlete_id', 'garmin_activity_id'],
    },
    defaults: { workout_feedback: () => ({ id: uid() }) },
  });
  db.tables.athletes.push({ id: TRAINEE, name: 'Dana', avatar_url: null });
  db.tables.athlete_activities.push({ id: uid(), athlete_id: TRAINEE, garmin_activity_id: 777 });
  db.tables.athlete_activities.push({ id: uid(), athlete_id: OTHER, garmin_activity_id: 888 });
  notifyStaff.mockClear();
  notifyAthlete.mockClear();
  coachesOf = [RINA];
});

describe('a pain report', () => {
  it('reaches the trainee\'s own coach as well as staff', async () => {
    expect((await post({ feel: 2, difficulty: 6, pain: true })).status).toBe(200);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    expect(notifyAthlete.mock.calls[0][0]).toMatchObject({ athleteId: RINA, kind: 'feedback_alert', category: 'coach' });
    expect(db.tables.workout_feedback).toHaveLength(1);
  });

  it('a trainee with no coach: the academy managers get it, and the answer says so (issue 8)', async () => {
    coachesOf = [];
    const res = await post({ feel: 2, difficulty: 6, pain: true });
    expect(await res.json()).toMatchObject({ success: true, painTo: 'managers', noCoach: true });
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    expect(notifyAthlete.mock.calls[0][0]).toMatchObject({ athleteId: MANAGER, kind: 'feedback_alert' });
  });

  it('is sent once: saving the same answer again alerts nobody', async () => {
    await post({ feel: 2, pain: true });
    await post({ feel: 3, pain: true });
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    expect(db.tables.workout_feedback).toHaveLength(1);
    expect(db.tables.workout_feedback[0].feel).toBe(3);
  });

  it('no pain, nothing to tell', async () => {
    await post({ feel: 3, difficulty: 5, pain: false });
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
});

describe('what the route refuses', () => {
  it('a feel outside 0–4, a difficulty outside 1–10, a pain that is not a boolean — 400, nothing stored, nobody told', async () => {
    for (const bad of [{ feel: 9 }, { feel: -1 }, { feel: 2.5 }, { feel: 'x' }, { difficulty: 11 }, { difficulty: 0 }, { pain: 'yes' }, { wantsFeedback: 1 }]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(db.tables.workout_feedback).toHaveLength(0);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it('null and absent answers are fine', async () => {
    expect((await post({ feel: null, difficulty: null, pain: null })).status).toBe(200);
    expect((await post({ feel: 0, difficulty: 10 })).status).toBe(200);
  });

  it('another trainee\'s activity id: 404, no row on it, no pain alert to the caller\'s coach', async () => {
    expect((await post({ activityId: 888, pain: true })).status).toBe(404);
    expect((await post({ activityId: 999, feel: 3 })).status).toBe(404);
    expect(db.tables.workout_feedback).toHaveLength(0);
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
});
