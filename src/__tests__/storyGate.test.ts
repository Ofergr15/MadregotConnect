import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('no default db in tests'); } }));
const { decideStoryGate, storyGate, storyGateMany } = await import('@/lib/stories/gate');
type Facts = Parameters<typeof decideStoryGate>[0];

const base: Facts = { paused: false, dbError: false, state: 'testers', athleteId: 'sahar', athleteActive: true, isTester: true, isAdmin: false };
const d = (o: Partial<Facts>) => decideStoryGate({ ...base, ...o });

/** A tiny PostgREST stand-in: tables → rows, or a table name → error. */
function fakeDb(tables: Record<string, Record<string, unknown>[] | 'error'>) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const ins: [string, unknown[]][] = [];
      const run = () => {
        const t = tables[table];
        if (t === 'error') return { data: null, error: { code: '42P01' } };
        const rows = (t || []).filter((r) => filters.every(([k, v]) => r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k])));
        return { data: rows, error: null };
      };
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
        in: (k: string, vs: unknown[]) => { ins.push([k, vs]); return b; },
        maybeSingle: async () => { const r = run(); return { data: r.data ? r.data[0] ?? null : null, error: r.error }; },
        then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
      };
      return b;
    },
  } as never;
}

describe('decideStoryGate (weekly edge cases)', () => {
  it('missing settings row → no, admin too', () => {
    expect(d({ state: null }).allowed).toBe(false);
    expect(d({ state: null, isAdmin: true }).reason).toBe('no_settings');
  });
  it('DB error → no, admin too', () => {
    expect(d({ dbError: true, isAdmin: true })).toMatchObject({ allowed: false, reason: 'db_error' });
  });
  it('stories_paused → no, whatever the state', () => {
    for (const state of ['self', 'testers', 'all'] as const) {
      expect(d({ paused: true, state, isAdmin: true }).allowed).toBe(false);
    }
  });
  it('off → no for admin and tester (#27)', () => {
    expect(d({ state: 'off', isAdmin: true }).allowed).toBe(false);
    expect(d({ state: 'off' }).allowed).toBe(false);
  });
  it('self → only the admin, and only as a preview', () => {
    expect(d({ state: 'self', isAdmin: true })).toMatchObject({ allowed: true, preview: true });
    expect(d({ state: 'self' })).toMatchObject({ allowed: false, reason: 'not_admin' });
  });
  it('testers → a listed, active athlete gets it, with the tester badge', () => {
    expect(d({})).toMatchObject({ allowed: true, preview: false, tester: true });
  });
  it('testers → a non-tester gets nothing (#29 removed tester)', () => {
    expect(d({ isTester: false })).toMatchObject({ allowed: false, reason: 'not_tester' });
  });
  it('testers → a listed tester who is no longer active gets nothing (#30)', () => {
    expect(d({ athleteActive: false })).toMatchObject({ allowed: false, reason: 'inactive' });
  });
  it('testers → an admin not on the list gets a preview only', () => {
    expect(d({ isTester: false, isAdmin: true })).toMatchObject({ allowed: true, preview: true, tester: false });
  });
  it('all → every active athlete, no badge; inactive ones nothing (#9)', () => {
    expect(d({ state: 'all', isTester: false })).toMatchObject({ allowed: true, tester: false, preview: false });
    expect(d({ state: 'all', athleteActive: false }).allowed).toBe(false);
  });
  it('an unknown state value → no', () => {
    expect(d({ state: 'club' as never, isAdmin: true }).allowed).toBe(false);
  });
});

describe('storyGate (reads)', () => {
  const rows = {
    app_settings: [{ key: 'stories_paused', value: 'off' }],
    story_feature_settings: [{ feature: 'weekly', state: 'testers' }],
    story_testers: [{ athlete_id: 'sahar' }],
    athletes: [{ id: 'sahar', status: 'active' }, { id: 'dana', status: 'active' }],
  };
  it('lets Sahar through and not Dana', async () => {
    expect((await storyGate('weekly', 'sahar', { db: fakeDb(rows) })).tester).toBe(true);
    expect((await storyGate('weekly', 'dana', { db: fakeDb(rows) })).allowed).toBe(false);
  });
  it('fails closed before migration 156 (table missing)', async () => {
    const db = fakeDb({ ...rows, story_feature_settings: 'error' });
    expect(await storyGate('weekly', 'sahar', { db })).toMatchObject({ allowed: false, reason: 'db_error' });
  });
  it('fails closed when the feature row is missing', async () => {
    expect((await storyGate('birthday', 'sahar', { db: fakeDb(rows) })).reason).toBe('no_settings');
  });
  it('honours stories_paused', async () => {
    const db = fakeDb({ ...rows, app_settings: [{ key: 'stories_paused', value: 'on' }] });
    expect((await storyGate('weekly', 'sahar', { db })).reason).toBe('paused');
  });
});

describe('storyGateMany (the Saturday push)', () => {
  const rows = {
    app_settings: [],
    story_feature_settings: [{ feature: 'weekly', state: 'testers', send_push: true }],
    story_testers: [{ athlete_id: 'sahar' }],
  };
  it('pushes only to testers', async () => {
    expect([...await storyGateMany('weekly', ['sahar', 'dana', 'ofer'], { db: fakeDb(rows) })]).toEqual(['sahar']);
  });
  it('self → pushes to nobody (preview never pushes)', async () => {
    const db = fakeDb({ ...rows, story_feature_settings: [{ feature: 'weekly', state: 'self', send_push: true }] });
    expect((await storyGateMany('weekly', ['sahar', 'ofer'], { db })).size).toBe(0);
  });
  it('all → everyone passed in', async () => {
    const db = fakeDb({ ...rows, story_feature_settings: [{ feature: 'weekly', state: 'all', send_push: true }] });
    expect((await storyGateMany('weekly', ['sahar', 'dana'], { db })).size).toBe(2);
  });
  it('any read error → nobody', async () => {
    const db = fakeDb({ ...rows, story_testers: 'error' });
    expect((await storyGateMany('weekly', ['sahar'], { db })).size).toBe(0);
    const db2 = fakeDb({ ...rows, app_settings: 'error' });
    expect((await storyGateMany('weekly', ['sahar'], { db: db2 })).size).toBe(0);
  });
  it('send_push=false → no push, while the screen stays open to the tester', async () => {
    const off = { ...rows, story_feature_settings: [{ feature: 'weekly', state: 'testers', send_push: false }], athletes: [{ id: 'sahar', status: 'active' }] };
    expect((await storyGateMany('weekly', ['sahar'], { db: fakeDb(off) })).size).toBe(0);
    expect((await storyGate('weekly', 'sahar', { db: fakeDb(off) })).allowed).toBe(true);
  });
  it('send_push missing → no push (fails closed)', async () => {
    const db = fakeDb({ ...rows, story_feature_settings: [{ feature: 'weekly', state: 'all' }] });
    expect((await storyGateMany('weekly', ['sahar'], { db })).size).toBe(0);
  });
});
