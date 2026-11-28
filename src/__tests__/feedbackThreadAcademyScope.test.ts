// Decision 28.11 (#204): an academy coach sees and answers only their own trainees'
// feedback threads (via requireTraineeAccess, which accepts any of a trainee's coaches);
// any other thread is a 404, not a 403. Club coaches, admins and the owner are unchanged.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

let n = 0;
const db = createMemoryDb({
  schema: {
    athletes: ['id', 'email', 'role', 'name', 'avatar_url'],
    workout_feedback: ['id', 'athlete_id', 'garmin_activity_id', 'athlete_last_read_at', 'coach_last_read_at'],
    workout_feedback_messages: ['id', 'feedback_id', 'sender_athlete_id', 'body', 'created_at'],
  },
  defaults: { workout_feedback_messages: () => ({ id: `m${++n}`, created_at: new Date().toISOString() }) },
});
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let caller: any = null;
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => caller,
}));
vi.mock('@/lib/push', () => ({ notifyAthlete: async () => {} }));
vi.mock('@/lib/academy/member-links', () => ({ feedbackReplyUrl: async () => '/x' }));
// trainee → their coaches (several allowed). The real helper reads the same relation.
const COACHES: Record<string, string[]> = { trainee: ['ac', 'ac2'], other: [] };
const accessCalls: string[] = [];
vi.mock('@/lib/academy/pairing-server', () => ({
  requireTraineeAccess: async (_req: Request, athleteId: string) => {
    accessCalls.push(athleteId);
    const ok = (COACHES[athleteId] ?? []).includes(caller?.caller?.athleteId);
    return { denied: ok ? null : new Response(JSON.stringify({ error: 'Not your trainee' }), { status: 403 }), caller: caller?.caller, pair: null };
  },
}));

const as = (email: string, id: string, role: string) =>
  ({ denied: null, caller: { email, athleteId: id, isStaff: role !== 'runner', isSuperUser: false, role } });

beforeEach(() => {
  for (const t of Object.values(db.tables)) t.length = 0;
  accessCalls.length = 0;
  db.tables.athletes.push(
    { id: 'trainee', email: 'trainee@example.test', role: 'runner', name: 'T', avatar_url: null },
    { id: 'other', email: 'other@example.test', role: 'runner', name: 'O', avatar_url: null },
    { id: 'ac', email: 'ac@example.test', role: 'academy_coach', name: 'AC', avatar_url: null },
    { id: 'ac2', email: 'ac2@example.test', role: 'academy_coach', name: 'AC2', avatar_url: null },
    { id: 'coach', email: 'coach@example.test', role: 'coach', name: 'C', avatar_url: null },
  );
  db.tables.workout_feedback.push(
    { id: 'fbT', athlete_id: 'trainee', garmin_activity_id: 'g1', athlete_last_read_at: null, coach_last_read_at: null },
    { id: 'fbO', athlete_id: 'other', garmin_activity_id: 'g2', athlete_last_read_at: null, coach_last_read_at: null },
  );
});

const get = async (id: string) => {
  const { GET } = await import('@/app/api/workout-feedback/[id]/messages/route');
  return GET(new Request('http://x'), { params: Promise.resolve({ id }) });
};
const post = async (id: string) => {
  const { POST } = await import('@/app/api/workout-feedback/[id]/messages/route');
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ body: 'hi' }) }), { params: Promise.resolve({ id }) });
};

describe('academy coach: own trainees only', () => {
  it('reads and answers their own trainee\'s thread', async () => {
    caller = as('ac@example.test', 'ac', 'academy_coach');
    const r = await get('fbT');
    expect(r.status).toBe(200);
    expect((await r.json()).viewerSide).toBe('coach');
    expect((await post('fbT')).status).toBe(200);
    expect(db.tables.workout_feedback_messages).toHaveLength(1);
    expect(accessCalls).toEqual(['trainee', 'trainee']);
  });
  it('a second coach of the same trainee has the same access', async () => {
    caller = as('ac2@example.test', 'ac2', 'academy_coach');
    expect((await get('fbT')).status).toBe(200);
  });
  it('another runner\'s thread is a 404 (not 403) on GET and POST, nothing written or stamped', async () => {
    caller = as('ac@example.test', 'ac', 'academy_coach');
    expect((await get('fbO')).status).toBe(404);
    expect((await post('fbO')).status).toBe(404);
    expect(db.tables.workout_feedback_messages).toHaveLength(0);
    expect(db.tables.workout_feedback.find((f) => f.id === 'fbO')?.coach_last_read_at).toBeNull();
  });
});

describe('unchanged sides', () => {
  it('a club coach still sees every thread, without the trainee check', async () => {
    caller = as('coach@example.test', 'coach', 'coach');
    expect((await get('fbO')).status).toBe(200);
    expect((await post('fbO')).status).toBe(200);
    expect(accessCalls).toHaveLength(0);
  });
  it('the owning athlete still reads and posts on their own thread', async () => {
    caller = as('other@example.test', 'other', 'runner');
    const r = await get('fbO');
    expect(r.status).toBe(200);
    expect((await r.json()).viewerSide).toBe('athlete');
    expect((await post('fbO')).status).toBe(200);
    expect(accessCalls).toHaveLength(0);
  });
  it('a runner on someone else\'s thread is still a 403', async () => {
    caller = as('other@example.test', 'other', 'runner');
    expect((await get('fbT')).status).toBe(403);
  });
});
