import { beforeEach, describe, expect, it, vi } from 'vitest';

const TRAINEE = 'trainee-1', COACH = 'coach-1', STRANGER = 'runner-9', MANAGER = 'mgr-1';

const who = vi.hoisted(() => ({ caller: null as Record<string, unknown> | null }));
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller: who.caller }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      let id = '';
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => { id = v; return q; },
        maybeSingle: async () => ({ data: id === TRAINEE ? { id: TRAINEE, academy_coach_id: COACH } : null, error: null }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/academy/trainee-coaches', () => ({ coachIdsOf: async () => [COACH] }));

// A fake channel that keeps Stream's read state, so the inbox's ✓✓ rule can be read off it.
const stream = vi.hoisted(() => ({ read: {} as Record<string, Record<string, string>>, calls: [] as Array<{ channel: string; user_id: string }> }));
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  getStreamServerClient: () => ({
    channel: (_t: string, id: string) => ({
      markRead: async ({ user_id }: { user_id: string }) => {
        stream.calls.push({ channel: id, user_id });
        (stream.read[id] ??= {})[user_id] = new Date().toISOString();
      },
    }),
  }),
}));

const { POST } = await import('@/app/api/academy/threads/read/route');

const as = (athleteId: string, roles: string[] = ['runner']) => {
  who.caller = { athleteId, role: roles[0], roles, isStaff: roles[0] !== 'runner', isSuperUser: false, email: athleteId };
};
const post = (body: unknown) => POST(new Request('http://x/api/academy/threads/read', { method: 'POST', body: JSON.stringify(body) }));

/** The inbox's rule (threads/inbox/route.ts): trainee's last_read >= newest message. */
const seenByTrainee = (lastAt: string) => {
  const lastRead = stream.read[`academy-${TRAINEE}`]?.[TRAINEE];
  return !!lastRead && new Date(lastRead).getTime() >= Date.parse(lastAt);
};

beforeEach(() => { stream.read = {}; stream.calls = []; });

describe('POST /api/academy/threads/read', () => {
  it('403s a caller who is not in the thread, and marks nothing', async () => {
    as(STRANGER);
    const res = await post({ athleteId: TRAINEE });
    expect(res.status).toBe(403);
    expect(stream.calls).toEqual([]);
  });

  it('marks only the caller\'s own read (coach), by athleteId or threadId', async () => {
    as(COACH, ['academy_coach']);
    const res = await post({ athleteId: TRAINEE });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, threadId: `academy-${TRAINEE}`, readerId: COACH });
    await post({ threadId: `academy-${TRAINEE}` });
    expect(stream.calls).toEqual([
      { channel: `academy-${TRAINEE}`, user_id: COACH },
      { channel: `academy-${TRAINEE}`, user_id: COACH },
    ]);
  });

  it('ignores any body identity: a coach cannot mark the trainee read', async () => {
    as(COACH, ['academy_coach']);
    await post({ athleteId: TRAINEE, userId: TRAINEE, readerId: TRAINEE, user_id: TRAINEE });
    expect(stream.calls.map(c => c.user_id)).toEqual([COACH]);
    expect(seenByTrainee(new Date(Date.now() - 1000).toISOString())).toBe(false);
  });

  it('a manager may mark their own read', async () => {
    as(MANAGER, ['academy_manager']);
    expect((await post({ athleteId: TRAINEE })).status).toBe(200);
    expect(stream.calls).toEqual([{ channel: `academy-${TRAINEE}`, user_id: MANAGER }]);
  });

  it('the trainee reading flips seenByTrainee; idempotent', async () => {
    const lastAt = new Date(Date.now() - 1000).toISOString();
    expect(seenByTrainee(lastAt)).toBe(false);
    as(TRAINEE);
    expect((await post({})).status).toBe(200); // defaults to their own thread
    expect((await post({ athleteId: TRAINEE })).status).toBe(200);
    expect(seenByTrainee(lastAt)).toBe(true);
    expect(stream.calls.every(c => c.user_id === TRAINEE)).toBe(true);
  });

  it('404s an unknown thread', async () => {
    as(COACH, ['academy_coach']);
    expect((await post({ athleteId: 'nobody' })).status).toBe(404);
  });
});
