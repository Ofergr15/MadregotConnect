import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { SUPER_USER_EMAIL } from '@/lib/constants';

/** PARTIAL
 * POST /api/workout-feedback — screen 6's pain switch says "אם כן, Rina מקבלת התראה", so a
 * pain report reaches the trainee's OWN academy coaches (not only the club's staff), and a
 * re-save of the same answer alerts nobody a second time.
 */

const TRAINEE = uid();
const RINA = uid();
const OTHER = uid();
const HEAD = uid();

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: async () => ({ denied: null, caller: { athleteId: TRAINEE } }),
  requireStaffCaller: async () => ({ denied: null }),
}));
const notifyStaff = vi.fn(async (_o: unknown) => {});
const MANAGER = uid();
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: (o: unknown) => notifyStaff(o) }));
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
      athletes: ['id', 'name', 'avatar_url', 'is_academy', 'role', 'extra_roles', 'email', 'status', 'is_super_user'],
      athlete_activities: ['id', 'athlete_id', 'garmin_activity_id'],
    },
    defaults: { workout_feedback: () => ({ id: uid() }) },
  });
  db.tables.athletes.push({ id: TRAINEE, name: 'Dana', avatar_url: null, email: 'dana@x.com', is_academy: true, role: 'runner' });
  db.tables.athletes.push({ id: HEAD, name: 'Ofer', avatar_url: null, email: SUPER_USER_EMAIL });
  db.tables.athletes.push({ id: MANAGER, name: 'Eldar', role: 'academy_coach', extra_roles: ['academy_manager'] });
  db.tables.athlete_activities.push({ id: uid(), athlete_id: TRAINEE, garmin_activity_id: 777 });
  db.tables.athlete_activities.push({ id: uid(), athlete_id: OTHER, garmin_activity_id: 888 });
  notifyStaff.mockClear();
  notifyAthlete.mockClear();
  coachesOf = [RINA];
});

describe('a one-field save', () => {
  it('keeps the difficulty, pain and comment already saved', async () => {
    await post({ feel: 2, difficulty: 7, pain: true, painDetail: 'knee', comment: 'hard' });
    expect((await post({ feel: 4 })).status).toBe(200);
    expect(db.tables.workout_feedback).toHaveLength(1);
    expect(db.tables.workout_feedback[0]).toMatchObject({ feel: 4, difficulty: 7, pain: true, pain_detail: 'knee', comment: 'hard' });
  });
  it('a field sent as null still clears it', async () => {
    await post({ feel: 2, difficulty: 7, comment: 'hard' });
    await post({ feel: 2, comment: null });
    expect(db.tables.workout_feedback[0]).toMatchObject({ difficulty: 7, comment: null });
  });
  it('re-sending only feel does not re-alert', async () => {
    await post({ feel: 2, pain: true });
    notifyAthlete.mockClear(); notifyStaff.mockClear();
    await post({ feel: 3 });
    expect(notifyStaff).not.toHaveBeenCalled();
  });
});

describe('night queue #63: the previous answer cannot be read', () => {
  const failOnce = (code: string) => {
    const real = db.client.from.bind(db.client);
    let armed = true;
    (db.client as any).from = (t: string) => {
      if (t !== 'workout_feedback' || !armed) return real(t);
      armed = false;
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { code, message: 'boom' } }) };
      return q;
    };
  };
  it('answers 500 and writes nothing — no nulled fields, no second pain alert', async () => {
    await post({ feel: 2, difficulty: 7, pain: true, comment: 'hard' });
    notifyAthlete.mockClear(); notifyStaff.mockClear();
    failOnce('XX000');
    const res = await post({ feel: 4 });
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toMatch(/boom/);              // a fixed message, not the DB text
    expect(db.tables.workout_feedback[0]).toMatchObject({ feel: 2, difficulty: 7, pain: true, comment: 'hard' });
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
  it('a missing column (pre-migration DB) still saves, as before', async () => {
    failOnce('42703');
    expect((await post({ feel: 3 })).status).toBe(200);
  });
});
