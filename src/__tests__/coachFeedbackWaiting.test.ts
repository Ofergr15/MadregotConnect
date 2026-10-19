import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The coach's "מחכים לך" (2026-10-19): POST /api/workout-feedback/handled closes only
 * feedback the caller may see, and /api/staff/attention — the number on "ניהול" — counts
 * what waits by the same rule as the tab: an answered thread is not waiting.
 */

const rows: Record<string, any[]> = {};
const updates: Array<{ table: string; patch: any; ids: string[] }> = [];
let staff = true;

function from(table: string) {
  const f: { in?: string[] } = {};
  let patch: any = null;
  const list = () => (rows[table] || []).filter((r) => !f.in || f.in.includes(r.id) || f.in.includes(r.feedback_id));
  const b: any = {};
  for (const m of ['select', 'gte', 'or', 'order', 'limit', 'eq']) b[m] = () => b;
  b.in = (_k: string, v: string[]) => { f.in = v; if (patch) updates.push({ table, patch, ids: v }); return b; };
  b.update = (p: any) => { patch = p; return b; };
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: list(), error: null }).then(ok);
  return b;
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from }) }));
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: 'coach', email: 'c@x.com', isStaff: staff, isSuperUser: false } }) }));
// An academy coach: only their own trainee "mine".
vi.mock('@/lib/academy/staff-scope', () => ({
  staffAthleteScope: async () => new Set(['mine']),
  inScope: (list: any[], scope: Set<string>, key: (r: any) => string) => (list || []).filter((r) => scope.has(key(r))),
}));

const { POST } = await import('@/app/api/workout-feedback/handled/route');
const attention = (await import('@/app/api/staff/attention/route')).GET;

beforeEach(() => {
  staff = true;
  updates.length = 0;
  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
  rows.workout_feedback = [
    { id: 'f1', athlete_id: 'mine', created_at: recent, pain: true, wants_feedback: false, comment: null, coach_reply_at: null },
    { id: 'f2', athlete_id: 'mine', created_at: recent, pain: false, wants_feedback: true, comment: null, coach_reply_at: null },
    { id: 'f3', athlete_id: 'other', created_at: recent, pain: true, wants_feedback: false, comment: null, coach_reply_at: null },
  ];
  rows.workout_feedback_messages = [{ feedback_id: 'f2', sender_athlete_id: 'coach', created_at: new Date().toISOString() }];
});

describe('marking handled', () => {
  it('stamps only the caller\'s own trainees\' feedback', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ ids: ['f1', 'f3'] }) }));
    expect(await res.json()).toEqual({ handled: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0].ids).toEqual(['f1']);
    expect(updates[0].patch.coach_reply_at).toBeTruthy();
    expect(updates[0].patch.coach_reply).toBeUndefined();
  });
  it('a runner may not', async () => {
    staff = false;
    expect((await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ ids: ['f1'] }) }))).status).toBe(403);
  });
});

describe('the number on "ניהול"', () => {
  it('counts what waits: the pain, not the request a coach already answered in its thread', async () => {
    const r = await (await attention(new Request('http://x'))).json();
    expect(r).toEqual({ pain: 1, wantsReply: 0, people: 1, total: 1 });
  });
});
