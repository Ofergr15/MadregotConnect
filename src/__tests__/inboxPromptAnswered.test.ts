import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promptActivityId, rowActionTargets, applyRowActions, type RawItem } from '@/lib/notifications/inbox';

/**
 * S5: post_workout_prompt rows carry `answered`, resolved for the inbox owner in one
 * batched workout_feedback read (in parallel with the other row lookups), so the
 * client no longer calls GET /api/workout-feedback once per prompt row.
 */

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  notifications: [] as Array<Record<string, unknown>>,
  feedback: { data: [] as unknown[], error: null as unknown },
  feedbackThrows: false,
}));

vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: ID, isStaff: false, isSuperUser: false } }),
}));
vi.mock('@/lib/feed/likes', () => ({ likedActivityIds: async () => new Set<string>() }));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const call = { table, ops: [] as Array<[string, unknown[]]> };
      h.calls.push(call);
      const q: any = {};
      for (const m of ['select', 'eq', 'or', 'not', 'is', 'gte', 'order', 'limit', 'in', 'returns']) {
        q[m] = (...args: unknown[]) => { call.ops.push([m, args]); return q; };
      }
      const result = (): Promise<unknown> => {
        if (table === 'athletes') return Promise.resolve({ data: { group_id: 'g1', role: 'runner', is_academy: false, last_seen_at: null, notification_prefs: null }, error: null });
        if (table === 'scheduled_notifications') return Promise.resolve({ data: h.notifications, error: null });
        if (table === 'workout_feedback') return h.feedbackThrows ? Promise.reject(new Error('boom')) : Promise.resolve(h.feedback);
        return Promise.resolve({ data: [], error: null });
      };
      q.maybeSingle = () => result();
      q.then = (ok: any, ko: any) => result().then(ok, ko);
      return q;
    },
  }),
}));

const { GET } = await import('@/app/api/notifications/inbox/route');
const ID = '11111111-1111-4111-8111-111111111111';
const req = () => new Request(`http://x/api/notifications/inbox?athleteId=${ID}`);
const row = (id: string, kind: string, url: string, sent: string) =>
  ({ id, kind, title_he: id, body_he: '', url, last_sent_at: sent, audience_type: 'athlete' });

beforeEach(() => {
  h.calls = []; h.feedbackThrows = false;
  h.feedback = { data: [{ garmin_activity_id: 111 }], error: null };
  h.notifications = [
    row('n1', 'post_workout_prompt', '/dashboard/feedback?activity=111', '2026-11-20T10:00:00Z'),
    row('n2', 'post_workout_prompt', '/dashboard/feedback?activity=222', '2026-11-19T10:00:00Z'),
    row('n3', 'custom', '/dashboard', '2026-11-18T10:00:00Z'),
  ];
});

const byId = (items: any[]) => Object.fromEntries(items.map((i) => [i.id, i]));

describe('promptActivityId', () => {
  it('reads the numeric activity off a prompt row only', () => {
    expect(promptActivityId({ kind: 'post_workout_prompt', url: '/dashboard/feedback?activity=123' })).toBe('123');
    expect(promptActivityId({ kind: 'post_workout_prompt', url: '/dashboard/feedback?x=1&activity=123&y=2' })).toBe('123');
    expect(promptActivityId({ kind: 'post_workout_prompt', url: '/dashboard/feedback' })).toBeNull();
    expect(promptActivityId({ kind: 'post_workout_prompt', url: '/dashboard/feedback?activity=abc' })).toBeNull();
    expect(promptActivityId({ kind: 'kudos_activity', url: '/feed?activity=123' })).toBeNull();
  });

  it('targets are deduped; applyRowActions leaves the field absent without a lookup', () => {
    const it = (id: string, a: string): RawItem => ({ id, kind: 'post_workout_prompt', title: '', body: '', url: `/dashboard/feedback?activity=${a}`, sentAt: '', unread: false, actorName: null, actorAvatarUrl: null });
    const items = [it('a', '1'), it('b', '1'), it('c', '2')];
    expect(rowActionTargets(items).promptActivityIds).toEqual(['1', '2']);
    expect(applyRowActions(items, {}).every((i) => !('answered' in i))).toBe(true);
    expect(applyRowActions(items, { answeredIds: new Set(['2']) }).map((i) => i.answered)).toEqual([false, false, true]);
  });
});

describe('GET /api/notifications/inbox answered', () => {
  it('one batched read scoped to the inbox owner, answered per row', async () => {
    const body = await (await GET(req())).json();
    const items = byId(body.items);
    expect(items.n1.answered).toBe(true);
    expect(items.n2.answered).toBe(false);
    expect('answered' in items.n3).toBe(false);
    const fb = h.calls.filter((c) => c.table === 'workout_feedback');
    expect(fb).toHaveLength(1);
    expect(fb[0].ops).toContainEqual(['eq', ['athlete_id', ID]]);
    expect(fb[0].ops).toContainEqual(['in', ['garmin_activity_id', [111, 222]]]);
  });

  it('no prompt rows → no feedback query', async () => {
    h.notifications = [h.notifications[2]];
    await GET(req());
    expect(h.calls.some((c) => c.table === 'workout_feedback')).toBe(false);
  });

  it('lookup error or throw → field absent, still 200', async () => {
    h.feedback = { data: null as any, error: { message: 'down' } };
    let res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).items.some((i: any) => 'answered' in i)).toBe(false);
    h.feedbackThrows = true;
    res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).items.some((i: any) => 'answered' in i)).toBe(false);
  });
});
