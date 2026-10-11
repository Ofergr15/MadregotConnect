import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * POST /api/workout-feedback — screen 6's pain switch says "אם כן, Rina מקבלת התראה", so a
 * pain report reaches the trainee's OWN academy coaches (not only the club's staff), and a
 * re-save of the same answer alerts nobody a second time.
 */

const TRAINEE = uid();
const RINA = uid();

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: async () => ({ denied: null, caller: { athleteId: TRAINEE } }),
  requireStaffCaller: async () => ({ denied: null }),
}));
const notifyStaff = vi.fn(async (_o: unknown) => {});
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: (o: unknown) => notifyStaff(o) }));
const notifyAthlete = vi.fn(async (_o: any) => {});
vi.mock('@/lib/push', () => ({ notifyAthlete: (o: unknown) => notifyAthlete(o) }));
vi.mock('@/lib/academy/trainee-coaches', () => ({ coachIdsOf: async () => [RINA] }));

const { POST } = await import('@/app/api/workout-feedback/route');
const post = (body: Record<string, unknown>) => POST(new Request('http://x/api/workout-feedback', {
  method: 'POST', body: JSON.stringify({ athleteId: TRAINEE, activityId: 777, ...body }),
}));

beforeEach(() => {
  db = createMemoryDb({
    schema: {
      workout_feedback: ['id', 'athlete_id', 'garmin_activity_id', 'difficulty', 'feel', 'pain', 'pain_detail', 'wants_feedback', 'comment'],
      athletes: ['id', 'name', 'avatar_url'],
    },
    defaults: { workout_feedback: () => ({ id: uid() }) },
  });
  db.tables.athletes.push({ id: TRAINEE, name: 'Dana', avatar_url: null });
  notifyStaff.mockClear();
  notifyAthlete.mockClear();
});

describe('a pain report', () => {
  it('reaches the trainee\'s own coach as well as staff', async () => {
    expect((await post({ feel: 2, difficulty: 6, pain: true })).status).toBe(200);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    expect(notifyAthlete.mock.calls[0][0]).toMatchObject({ athleteId: RINA, kind: 'feedback_alert', category: 'coach' });
    expect(db.tables.workout_feedback).toHaveLength(1);
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
