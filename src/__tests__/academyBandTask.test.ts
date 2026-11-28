import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from 'next-intl';
import he from '../../messages/he.json';
import en from '../../messages/en.json';

// "לשבץ דבוקה" (2026-11-18): a trainee who joins with no band is their coach's task — one
// push at the first sign-in, a task derived from the roster, never a guessed band.

const pushes: any[] = [];
const staff: any[] = [];
let coaches: string[] = [];
vi.mock('@/lib/push', () => ({ notifyAthlete: (o: any) => { pushes.push(o); return Promise.resolve({ subscriptions: 1, delivered: 1 }); } }));
vi.mock('@/lib/notifications/staff', () => ({
  academyManagerIds: async () => ['mgr-1'],
  notifyStaff: async (o: any) => { staff.push(o); return { recipients: 1, sent: 1 }; },
}));
vi.mock('@/lib/academy/trainee-coaches', () => ({ coachIdsOf: async () => coaches }));

// A tiny athletes table: reads, and the auth/me first_seen_at race guard (`.is(col, null)`).
type Row = Record<string, any>;
let rows: Record<string, Row> = {};
const writes: Array<{ id: string; patch: Row }> = [];
function fakeDb() {
  return {
    from(table: string) {
      const q: any = { table, op: 'select', filters: {} as Row, nulls: [] as string[], patch: null as Row | null, ret: false, single: false };
      const run = () => {
        if (table !== 'athletes') return { data: q.single ? null : [], error: null };
        const id = q.filters.id;
        const row = rows[id];
        if (q.op === 'update') {
          if (!row || q.nulls.some((c: string) => row[c] != null)) return { data: [], error: null };
          writes.push({ id, patch: q.patch });
          Object.assign(row, q.patch);
          return { data: q.ret ? [{ id }] : null, error: null };
        }
        return { data: q.single ? row ?? null : row ? [row] : [], error: null };
      };
      const b: any = {
        select: () => { if (q.op === 'update') q.ret = true; return b; },
        update: (p: Row) => { q.op = 'update'; q.patch = p; return b; },
        eq: (c: string, v: unknown) => { q.filters[c] = v; return b; },
        is: (c: string) => { q.nulls.push(c); return b; },
        in: () => b, contains: () => b, order: () => b, limit: () => b,
        maybeSingle: () => { q.single = true; return Promise.resolve(run()); },
        single: () => { q.single = true; return Promise.resolve(run()); },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return b;
    },
  };
}

const pending: Promise<unknown>[] = [];
vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: (fn: () => Promise<unknown>) => { pending.push(fn()); } }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb() }));
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { athleteId: 't-1', role: 'runner', roles: ['runner'], athleteStatus: 'active' } }),
  authError: () => new Response(null, { status: 401 }),
}));

const { notifyTraineeJoined, bandMissingTag } = await import('@/lib/academy/loop-notify');
const { bandTasks } = await import('@/lib/academy/band-task');
const { buildActionCards, actionCardKeys } = await import('@/lib/academy/action-cards');
const { GET } = await import('@/app/api/auth/me/route');

const signIn = async () => {
  await GET(new Request('http://x/api/auth/me'));
  await Promise.all(pending.splice(0));
};

beforeEach(() => {
  pushes.length = 0; staff.length = 0; writes.length = 0; pending.length = 0;
  coaches = ['coach-1'];
  rows = { 't-1': { id: 't-1', name: 'נועה לוי', is_academy: true, approved: true, first_seen_at: null, academy_band_id: null } };
});

describe('first sign-in of a trainee with no band', () => {
  it('band null + a coach: ONE push to the coach, opening the טופס התאמה, with the stable tag', async () => {
    await signIn();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      athleteId: 'coach-1', kind: 'academy_band_missing', tag: 'academy-band-missing-t-1', category: 'coach',
      url: '/dashboard/academy/week?athleteId=t-1&setup=1',
    });
    expect(pushes[0].copy('he').body).toContain('עדיין אין דבוקה');
    expect(pushes[0].copy('en').body).toContain('No pack yet');
    expect(staff).toHaveLength(0);
  });

  it('a second sign-in sends nothing: only the request that wins the first_seen_at stamp notifies', async () => {
    await signIn();
    await signIn();
    await signIn();
    expect(pushes).toHaveLength(1);
  });

  it('band already set: the plain "joined" push, no band task, no band-missing tag', async () => {
    rows['t-1'].academy_band_id = 'band-3';
    await signIn();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ kind: 'academy_trainee_joined', tag: 'academy-joined-t-1' });
    expect(pushes[0].url).not.toContain('setup=1');
    expect(staff).toHaveLength(0);
  });

  it('no coach: the managers get a notifyStaff item with the stable tag, and no coach is picked', async () => {
    coaches = [];
    await signIn();
    expect(pushes).toHaveLength(0);
    expect(staff).toHaveLength(1);
    expect(staff[0]).toMatchObject({
      kind: 'academy_band_missing_no_coach', tag: bandMissingTag('t-1'), category: 'management',
      extraRecipientIds: ['mgr-1'], url: '/dashboard/academy?tab=coaches',
    });
    expect(staff[0].copy('he').title).toContain('בלי מאמן ובלי דבוקה');
    // Nothing assigned a coach or a band on the way.
    expect(writes.every((w) => !('academy_band_id' in w.patch) && !('academy_coach_id' in w.patch))).toBe(true);
  });

  it('never writes a band, and never overwrites one that is set', async () => {
    rows['t-1'].academy_band_id = 'band-3';
    await signIn();
    await notifyTraineeJoined(fakeDb() as never, 't-1');
    expect(rows['t-1'].academy_band_id).toBe('band-3');
    expect(writes.map((w) => Object.keys(w.patch)).flat()).not.toContain('academy_band_id');
  });

  it('not an academy trainee: nothing', async () => {
    rows['t-1'].is_academy = false;
    await notifyTraineeJoined(fakeDb() as never, 't-1');
    expect(pushes.length + staff.length).toBe(0);
  });
});

describe('the "לשבץ דבוקה" task, derived from the roster', () => {
  const m = (over: Record<string, unknown> = {}) => ({
    athleteId: 't-1', name: 'נועה', approved: true, status: 'active', band: null as { id: string } | null,
    academyCoachId: 'coach-1', academyCoachIds: ['coach-1'], ...over,
  });

  it('band null + coach: a visible coach task', () => {
    const t = bandTasks([m()]);
    expect(t.needsBand).toEqual([{ athleteId: 't-1', name: 'נועה' }]);
    const cards = buildActionCards({ band: t.needsBand.length });
    expect(cards.map((c) => c.kind)).toEqual(['band']);
  });

  it('band set: the task is gone, with no state to clear', () => {
    const t = bandTasks([m({ band: { id: 'band-3' } })]);
    expect(t).toEqual({ needsBand: [], noCoach: [] });
    expect(buildActionCards({ band: t.needsBand.length, bandNoCoach: t.noCoach.length })).toEqual([]);
  });

  it('no coach: the managers item only, never the coach task', () => {
    const t = bandTasks([m({ academyCoachId: null, academyCoachIds: [] })]);
    expect(t.needsBand).toEqual([]);
    expect(t.noCoach).toHaveLength(1);
    expect(buildActionCards({ bandNoCoach: t.noCoach.length }).map((c) => c.kind)).toEqual(['bandNoCoach']);
  });

  it('skips the not-yet-approved, the removed, and an academy with no bands at all', () => {
    expect(bandTasks([m({ approved: false }), m({ status: 'removed' })]).needsBand).toEqual([]);
    expect(bandTasks([m()], false).needsBand).toEqual([]);
  });

  it('copy: the number isolated, the Hebrew and English agree', () => {
    const tHe = createTranslator({ locale: 'he', messages: he, namespace: 'actionCards' });
    const tEn = createTranslator({ locale: 'en', messages: en, namespace: 'actionCards' });
    const [band, noCoach] = buildActionCards({ band: 3, bandNoCoach: 2 });
    const text = (t: typeof tHe, c: typeof band) => t.markup(actionCardKeys(c.kind).text, { count: c.count, extra: c.extra, n: (s) => `[${s}]` });
    expect(tHe(actionCardKeys('band').title)).toBe('לשבץ דבוקה');
    expect(text(tHe, band)).toBe('[3 מתאמנים] עדיין בלי דבוקה. הדבוקה נקבעת בטופס ההתאמה');
    expect(text(tHe, noCoach)).toBe('[2 מתאמנים] בלי מאמן ובלי דבוקה. המאמן שישובץ יקבע את הדבוקה');
    expect(text(tEn, band)).toBe('[3 trainees] have no pack yet. The pack is set in the coaching form');
  });
});
