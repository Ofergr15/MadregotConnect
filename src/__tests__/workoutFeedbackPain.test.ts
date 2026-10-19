import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { SUPER_USER_EMAIL } from '@/lib/constants';

/**
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

describe('a pain report', () => {
  it('reaches the trainee\'s own coach and the academy manager as well as staff', async () => {
    expect((await post({ feel: 2, difficulty: 6, pain: true })).status).toBe(200);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(notifyAthlete.mock.calls.map((c) => c[0].athleteId).sort()).toEqual([RINA, MANAGER].sort());
    expect(notifyAthlete.mock.calls[0][0]).toMatchObject({ kind: 'feedback_alert', category: 'coach' });
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
    expect(notifyAthlete).toHaveBeenCalledTimes(2);
    expect(db.tables.workout_feedback).toHaveLength(1);
    expect(db.tables.workout_feedback[0].feel).toBe(3);
  });

  it('a club runner asking for a reply reaches the club coach — not the QA fixture', async () => {
    const YAIR = uid();
    const club = db.tables.athletes.find((a) => a.id === TRAINEE)!;
    club.is_academy = false;
    db.tables.athletes.push(
      { id: YAIR, name: 'Yair', role: 'coach', email: 'strava_1@strava.madregot.local', status: 'active' },
      { id: uid(), name: 'Test Coach', role: 'coach', email: 'test-coach@madregot.local', status: 'active' },
    );
    expect((await post({ feel: 3, wantsFeedback: true })).status).toBe(200);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(notifyAthlete.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ athleteId: YAIR, kind: 'feedback_alert', url: '/dashboard/workout-feedback' }),
    ]);
  });

  it('no pain, nothing to tell', async () => {
    await post({ feel: 3, difficulty: 5, pain: false });
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
});

describe('who hears about it (10-19: every alert had gone to the club account alone)', () => {
  it('the head coach is added to the staff alert, though his role is runner', async () => {
    await post({ feel: 2, pain: true });
    expect(notifyStaff.mock.calls[0][0]).toMatchObject({ kind: 'feedback_alert', extraRecipientIds: [HEAD] });
  });

  it('a request for feedback reaches the trainee\'s own coach too — and promises nothing about pain', async () => {
    const res = await post({ feel: 3, difficulty: 5, wantsFeedback: true });
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    // Their coach, and the academy managers (feedback-recipients.ts) — each once.
    const told = notifyAthlete.mock.calls.map((c) => (c[0] as { athleteId: string; kind: string }));
    expect(told.map((x) => x.athleteId).sort()).toEqual([MANAGER, RINA].sort());
    expect(told.every((x) => x.kind === 'feedback_alert')).toBe(true);
    expect(await res.json()).toEqual({ success: true });
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
