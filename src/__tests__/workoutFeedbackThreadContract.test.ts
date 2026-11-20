// B14: workout-feedback thread side effects, for a native chat. FIXTURE only;
// notifyAthlete (push + in-app row) is stubbed and counted: nothing is sent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

let n = 0;
const db = createMemoryDb({
  schema: {
    athletes: ['id', 'email', 'role', 'name', 'avatar_url'],
    workout_feedback: ['id', 'athlete_id', 'garmin_activity_id', 'athlete_last_read_at', 'coach_last_read_at'],
    workout_feedback_messages: ['id', 'feedback_id', 'sender_athlete_id', 'body', 'created_at'],
  },
  defaults: { workout_feedback_messages: () => ({ id: `m${++n}`, created_at: new Date(Date.UTC(2026, 10, 20, 20, 0, n)).toISOString() }) },
});
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<typeof import('@/lib/constants')>()), isSuperUser: () => false }));
let caller: any = null;
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/self-or-staff')>()), resolveVerifiedCaller: async () => caller }));
const pushes: unknown[] = [];
vi.mock('@/lib/push', () => ({ notifyAthlete: async (x: unknown) => { pushes.push(x); } }));
vi.mock('@/lib/academy/member-links', () => ({ feedbackReplyUrl: async () => '/x' }));

const as = (email: string, extra: object = {}) => ({ denied: null, caller: { email, athleteId: null, isStaff: false, isSuperUser: false, role: '', ...extra } });
const route = () => import('@/app/api/workout-feedback/[id]/messages/route');
const get = async () => { const r = await (await route()).GET(new Request('http://x'), { params: Promise.resolve({ id: 'fb1' }) }); return { status: r.status, body: await r.json() }; };
const post = async (body: string) => { const r = await (await route()).POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ body }) }), { params: Promise.resolve({ id: 'fb1' }) }); return { status: r.status, body: await r.json() }; };
const fb = () => db.tables.workout_feedback[0];

beforeEach(() => {
  for (const t of Object.values(db.tables)) t.length = 0;
  pushes.length = 0;
  db.tables.athletes.push(
    { id: 'ath', email: 'ath@example.test', role: 'runner', name: 'A', avatar_url: null },
    { id: 'coach', email: 'coach@example.test', role: 'coach', name: 'C', avatar_url: null },
    { id: 'mate', email: 'mate@example.test', role: 'runner', name: 'M', avatar_url: null },
  );
  db.tables.workout_feedback.push({ id: 'fb1', athlete_id: 'ath', garmin_activity_id: 'g1', athlete_last_read_at: null, coach_last_read_at: null });
});

describe('workout-feedback thread contract', () => {
  it('a teammate is 403 on read and write; nothing stamped or inserted', async () => {
    caller = as('mate@example.test');
    expect((await get()).status).toBe(403);
    expect((await post('hi')).status).toBe(403);
    expect(fb()).toMatchObject({ athlete_last_read_at: null, coach_last_read_at: null });
    expect(db.tables.workout_feedback_messages).toHaveLength(0);
  });
  it('NATIVE HAZARD: a GET marks the viewer side read', async () => {
    caller = as('ath@example.test');
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.viewerSide).toBe('athlete');
    expect(fb().athlete_last_read_at).not.toBeNull();
    expect(fb().coach_last_read_at).toBeNull();
  });
  it('a GET under view-as does NOT mark read', async () => {
    caller = as('ath@example.test', { viewingAsBy: 'admin@example.test' });
    await get();
    expect(fb().athlete_last_read_at).toBeNull();
  });
  it('400 for an empty body', async () => {
    caller = as('ath@example.test');
    expect((await post('   ')).status).toBe(400);
  });
  it('NATIVE HAZARD: replaying a POST inserts a duplicate message (no idempotency key)', async () => {
    caller = as('ath@example.test');
    await post('same');
    await post('same');
    expect(db.tables.workout_feedback_messages.filter((m) => m.body === 'same')).toHaveLength(2);
  });
  it('a coach reply notifies the athlete once per POST; an athlete message notifies nobody here', async () => {
    caller = as('ath@example.test');
    await post('from athlete');
    expect(pushes).toHaveLength(0);
    caller = as('coach@example.test');
    await post('from coach');
    expect(pushes).toHaveLength(1);
    expect(fb().coach_last_read_at).not.toBeNull();
  });
});
