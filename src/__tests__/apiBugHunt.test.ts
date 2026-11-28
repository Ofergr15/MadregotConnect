// Task 75 bug hunt over src/app/api/**: one test per bug fixed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { insertRunChatOnce } from '@/lib/run-chat/insert-once';

let n = 0;
const db = createMemoryDb({
  schema: {
    athletes: ['id', 'email', 'role', 'name', 'avatar_url'],
    workout_feedback: ['id', 'athlete_id', 'garmin_activity_id', 'athlete_last_read_at', 'coach_last_read_at'],
    workout_feedback_messages: ['id', 'feedback_id', 'sender_athlete_id', 'body', 'created_at'],
    challenges: ['id', 'badge_id', 'name_he', 'name_en', 'description_he', 'description_en', 'metric', 'target_value', 'scope', 'start_date', 'end_date', 'active'],
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
const pushes: unknown[] = [];
vi.mock('@/lib/push', () => ({ notifyAthlete: async (x: unknown) => { pushes.push(x); } }));
vi.mock('@/lib/academy/member-links', () => ({ feedbackReplyUrl: async () => '/x' }));
vi.mock('@/lib/challenges/engine', async (orig) => ({
  ...(await orig<typeof import('@/lib/challenges/engine')>()),
  computeChallengeProgress: async () => new Map(),
}));

const as = (email: string, id: string | null, extra: object = {}) =>
  ({ denied: null, caller: { email, athleteId: id, isStaff: false, isSuperUser: false, role: 'runner', ...extra } });

beforeEach(() => {
  for (const t of Object.values(db.tables)) t.length = 0;
  pushes.length = 0;
  db.tables.athletes.push(
    { id: 'ath', email: 'ath@example.test', role: 'runner', name: 'A', avatar_url: null },
    { id: 'coach', email: 'coach@example.test', role: 'coach', name: 'C', avatar_url: null },
  );
  db.tables.workout_feedback.push({ id: 'fb1', athlete_id: 'ath', garmin_activity_id: 'g1', athlete_last_read_at: null, coach_last_read_at: null });
});
afterEach(() => vi.useRealTimers());

describe('workout-feedback thread POST is read-only while viewing as', () => {
  const post = async () => {
    const { POST } = await import('@/app/api/workout-feedback/[id]/messages/route');
    return POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ body: 'hi' }) }), { params: Promise.resolve({ id: 'fb1' }) });
  };
  it('staff viewing as the runner cannot post as them (403, nothing written, no push)', async () => {
    caller = as('ath@example.test', 'ath', { viewingAsBy: 'admin@example.test' });
    expect((await post()).status).toBe(403);
    expect(db.tables.workout_feedback_messages).toHaveLength(0);
    expect(pushes).toHaveLength(0);
  });
  it('the runner themselves still can', async () => {
    caller = as('ath@example.test', 'ath');
    expect((await post()).status).toBe(200);
    expect(db.tables.workout_feedback_messages).toHaveLength(1);
  });
});

describe('attendance/lineup requires a day', () => {
  it('a missing day is a 400, not Sunday', async () => {
    const { GET } = await import('@/app/api/attendance/lineup/route');
    expect((await GET(new Request('http://x/api/attendance/lineup?weekStart=2026-11-22'))).status).toBe(400);
    expect((await GET(new Request('http://x/api/attendance/lineup?weekStart=2026-11-22&day='))).status).toBe(400);
  });
});

describe('challenges use the Israel day', () => {
  it('at 00:30 Israel (22:30 UTC) a challenge starting "today" is active and yesterday\'s has ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T22:30:00Z')); // 2026-11-28 00:30 in Israel
    const base = { badge_id: null, name_he: 'x', name_en: 'x', description_he: null, description_en: null, metric: 'km', target_value: 10, scope: 'individual', active: true };
    db.tables.challenges.push(
      { id: 'starts-today', ...base, start_date: '2026-11-28', end_date: '2026-12-05' },
      { id: 'ended-yesterday', ...base, start_date: '2026-11-20', end_date: '2026-11-27' },
    );
    caller = as('ath@example.test', 'ath');
    const { GET } = await import('@/app/api/challenges/route');
    const res = await GET(new Request('http://x/api/challenges?athleteId=ath'));
    const ids = JSON.stringify(await res.json());
    expect(ids).toContain('starts-today');
    expect(ids).not.toContain('ended-yesterday');
  });
});

describe('run chat: a concurrent create takes the row that won', () => {
  const fake = (insertError: { code: string } | null, existing: Record<string, unknown> | null) => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : { data: { id: 'new' }, error: null }) }) }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }),
    }),
  });
  it('inserts when free', async () => {
    expect(await insertRunChatOnce(fake(null, null), { activity_id: 'a' })).toEqual({ id: 'new' });
  });
  it('23505 → re-reads the existing row instead of a 500', async () => {
    expect(await insertRunChatOnce(fake({ code: '23505' }, { id: 'won' }), { activity_id: 'a' })).toEqual({ id: 'won' });
  });
  it('any other error, or a 23505 with nothing to re-read, still throws', async () => {
    await expect(insertRunChatOnce(fake({ code: '42501' }, null), { activity_id: 'a' })).rejects.toMatchObject({ code: '42501' });
    await expect(insertRunChatOnce(fake({ code: '23505' }, null), { activity_id: 'a' })).rejects.toMatchObject({ code: '23505' });
  });
});
