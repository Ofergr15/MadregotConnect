import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('no default db in tests'); } }));
vi.mock('@/lib/notifications/copy', () => ({ birthdayYearCopy: (_l: string, p: { name: string; km: number }) => ({ title: `🎂 ${p.name}`, body: `${p.km}` }) }));

const { decideStoryGate, storyGateMany } = await import('@/lib/stories/gate');
const inst = await import('@/lib/stories/instances');
const { recentBirthday, upcomingBirthday, annualPeriod, nextAnnualPeriod, bucketOf } = await import('@/lib/stories/schedule');
const { runBirthdayStoryPushes, runAnnualStoryPushes } = await import('@/lib/stories/runners');
const { storyAccess } = await import('@/lib/stories/access');
const { birthdayPostAllowed } = await import('@/lib/feed/birthday');
const { settingsPatch, rowStatus, nextSaturday } = await import('@/lib/stories/admin');
const { parseStoryPrefs } = await import('@/lib/stories/prefs');
type Settings = import('@/lib/stories/gate').StorySettingsRow;

const birthday: Settings = { feature: 'birthday', state: 'all', send_push: true, feed_post: true, generate_at: '07:00', weekday: null, annual_date: null, display_days: 7, min_runs: 10 };
const annual: Settings = { ...birthday, feature: 'annual', generate_at: '18:00', annual_date: '12-31', display_days: 31 };

/** An in-memory PostgREST stand-in good enough for the runners: select/eq/not/in/is, upsert on a key, update…select. */
function memDb(tables: Record<string, Record<string, unknown>[]>, opts: { missing?: string[] } = {}) {
  const keyOf = (r: Record<string, unknown>) => `${r.athlete_id}:${r.feature}:${r.period}`;
  return {
    tables,
    from(table: string) {
      const preds: Array<(r: Record<string, unknown>) => boolean> = [];
      let op: 'select' | 'update' = 'select';
      let patch: Record<string, unknown> = {};
      const missing = opts.missing?.includes(table);
      const rows = () => (tables[table] ||= []);
      const run = () => {
        if (missing) return { data: null, error: { code: '42P01', message: table } };
        const hit = rows().filter((r) => preds.every((p) => p(r)));
        if (op === 'update') for (const r of hit) Object.assign(r, patch);
        return { data: hit.map((r) => ({ ...r })), error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => { preds.push((r) => r[k] === v); return b; },
        not: (k: string, _o: string, v: unknown) => { preds.push((r) => r[k] !== v && r[k] !== undefined); return b; },
        in: (k: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[k])); return b; },
        is: (k: string, v: unknown) => { preds.push((r) => (r[k] ?? null) === v); return b; },
        order: () => b, limit: () => b,
        maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        update: (p: Record<string, unknown>) => { op = 'update'; patch = p; return b; },
        upsert: async (row: Record<string, unknown>, o: { ignoreDuplicates?: boolean } = {}) => {
          if (missing) return { error: { code: '42P01', message: table } };
          const ex = rows().find((r) => keyOf(r) === keyOf(row));
          if (ex) { if (!o.ignoreDuplicates) Object.assign(ex, row); } else rows().push({ pushed_at: null, ...row });
          return { error: null };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      };
      return b;
    },
  };
}

function deps(over: Partial<import('@/lib/stories/runners').RunnerDeps> = {}, runs = 20) {
  const sent: string[] = [];
  return {
    sent,
    d: {
      readSettings: async (f: string) => (f === 'annual' ? annual : birthday),
      gateMany: async (_f: string, ids: string[]) => new Set(ids),
      loadBirthday: async (_db: unknown, id: string, today: string) => ({
        athleteId: id, name: id, avatarUrl: null, birthday: recentBirthday(id === 'leap' ? '1992-02-29' : '1990-10-19', today, 31)!, stats: { km: 100, runs } as never, config: {},
      }),
      loadAnnual: async (_db: unknown, id: string, year: number) => ({ athleteId: id, name: id, avatarUrl: null, birthday: `${year}-12-31`, stats: { km: 900, runs } as never, config: {} }),
      notify: async (o: { athleteId: string }) => { sent.push(o.athleteId); },
      ...over,
    } as import('@/lib/stories/runners').RunnerDeps,
  };
}
const ledger = () => {
  const tags = new Set<string>();
  return { tags, already: async (t: string) => tags.has(t), markFired: async (t: string) => { tags.add(t); } };
};
const COACH = (await import('@/lib/constants')).COACH_ID;
const athlete = (id: string, birth_date: string | null, status = 'active') => ({ id, birth_date, status, coach_id: COACH });
// 2026-10-19 07:10 Israel (UTC+3) = 04:10Z
const at0710 = new Date('2026-10-19T04:10:00Z');

describe('edge case: Feb 29', () => {
  it('is celebrated on Mar 1 in a common year, on Feb 29 in a leap year', () => {
    expect(recentBirthday('1992-02-29', '2027-03-01')).toBe('2027-03-01');
    expect(upcomingBirthday('1992-02-29', '2027-02-20')).toBe('2027-03-01');
    expect(upcomingBirthday('1992-02-29', '2028-02-20')).toBe('2028-02-29');
  });
});

describe('edge case: no birth date', () => {
  it('has no occurrence and gets no push', async () => {
    expect(recentBirthday(null, '2026-10-19')).toBeNull();
    const db = memDb({ athletes: [athlete('nobd', null)], story_instances: [] });
    const { d, sent } = deps();
    expect(await runBirthdayStoryPushes(db as never, at0710, ledger(), d)).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe('birthday runner', () => {
  it('pushes the birthday person once their 07:00 has come', async () => {
    const db = memDb({ athletes: [athlete('dana', '1990-10-19')], story_instances: [] });
    const { d, sent } = deps();
    expect(await runBirthdayStoryPushes(db as never, at0710, ledger(), d)).toBe(1);
    expect(sent).toEqual(['dana']);
    expect(db.tables.story_instances[0].pushed_at).toBeTruthy();
  });

  it('edge case: the cron running twice sends once (unique key + pushed_at claim)', async () => {
    const db = memDb({ athletes: [athlete('dana', '1990-10-19')], story_instances: [] });
    const { d, sent } = deps();
    await runBirthdayStoryPushes(db as never, at0710, ledger(), d);
    await runBirthdayStoryPushes(db as never, new Date(at0710.getTime() + 5 * 60_000), ledger(), d);
    expect(sent).toEqual(['dana']);
    expect(db.tables.story_instances).toHaveLength(1);
  });

  it('before 157 (no table) the ledger tag keeps it to one push', async () => {
    const db = memDb({ athletes: [athlete('dana', '1990-10-19')] }, { missing: ['story_instances'] });
    const { d, sent } = deps();
    const l = ledger();
    await runBirthdayStoryPushes(db as never, at0710, l, d);
    await runBirthdayStoryPushes(db as never, at0710, l, d);
    expect(sent).toEqual(['dana']);
  });

  it('nothing before the publish time, nothing past the 3h grace (no backfill)', async () => {
    const db = memDb({ athletes: [athlete('dana', '1990-10-19')], story_instances: [] });
    const { d, sent } = deps();
    await runBirthdayStoryPushes(db as never, new Date('2026-10-19T03:50:00Z'), ledger(), d); // 06:50
    await runBirthdayStoryPushes(db as never, new Date('2026-10-19T07:30:00Z'), ledger(), d); // 10:30
    expect(sent).toEqual([]);
  });

  it('edge case: under min runs → no push; the admin may waive it (enabled=true)', async () => {
    const db = memDb({ athletes: [athlete('dana', '1990-10-19')], story_instances: [] });
    const { d, sent } = deps({}, 3);
    await runBirthdayStoryPushes(db as never, at0710, ledger(), d);
    expect(sent).toEqual([]);
    db.tables.story_instances = [{ athlete_id: 'dana', feature: 'birthday', period: '2026-10-19', enabled: true, pushed_at: null }];
    await runBirthdayStoryPushes(db as never, at0710, ledger(), d);
    expect(sent).toEqual(['dana']);
  });

  it('edge case: removed / disconnected athletes are never candidates', async () => {
    const db = memDb({ athletes: [athlete('gone', '1990-10-19', 'removed'), athlete('off', '1990-10-19', 'disconnected')], story_instances: [] });
    const { d, sent } = deps();
    await runBirthdayStoryPushes(db as never, at0710, ledger(), d);
    expect(sent).toEqual([]);
  });

  it('the gate decides: closed state or not in the gated set → nothing', async () => {
    const db = memDb({ athletes: [athlete('dana', '1990-10-19')], story_instances: [] });
    for (const state of ['off', 'self'] as const) {
      const { d, sent } = deps({ readSettings: async () => ({ ...birthday, state }) });
      await runBirthdayStoryPushes(db as never, at0710, ledger(), d);
      expect(sent).toEqual([]);
    }
    const { d, sent } = deps({ gateMany: async () => new Set() });
    await runBirthdayStoryPushes(db as never, at0710, ledger(), d);
    expect(sent).toEqual([]);
  });

  it('a skip override closes it; a postponed one goes out the next day', async () => {
    const db = memDb({ athletes: [athlete('dana', '1990-10-19')], story_instances: [{ athlete_id: 'dana', feature: 'birthday', period: '2026-10-19', skipped: true, pushed_at: null }] });
    const { d, sent } = deps();
    await runBirthdayStoryPushes(db as never, at0710, ledger(), d);
    expect(sent).toEqual([]);
    db.tables.story_instances[0].skipped = false;
    db.tables.story_instances[0].publish_at = '2026-10-20T04:00:00Z';
    await runBirthdayStoryPushes(db as never, at0710, ledger(), d);
    expect(sent).toEqual([]);
    await runBirthdayStoryPushes(db as never, new Date('2026-10-20T04:05:00Z'), ledger(), d);
    expect(sent).toEqual(['dana']);
  });

  it('the legacy per-story published:false still closes; published:true opens nothing (gate closed)', async () => {
    const db = memDb({ athletes: [athlete('dana', '1990-10-19')], story_instances: [] });
    const closed = deps({ loadBirthday: async (_db, id) => ({ athleteId: id, name: id, avatarUrl: null, birthday: '2026-10-19', stats: { km: 1, runs: 20 } as never, config: { published: false } }) });
    await runBirthdayStoryPushes(db as never, at0710, ledger(), closed.d);
    expect(closed.sent).toEqual([]);
    const forced = deps({
      readSettings: async () => ({ ...birthday, state: 'off' }),
      loadBirthday: async (_db, id) => ({ athleteId: id, name: id, avatarUrl: null, birthday: '2026-10-19', stats: { km: 1, runs: 20 } as never, config: { published: true } }),
    });
    await runBirthdayStoryPushes(db as never, at0710, ledger(), forced.d);
    expect(forced.sent).toEqual([]);
  });
});

describe('annual', () => {
  it('runs from Dec 31 at 18:00 and is open until Jan 31', () => {
    expect(annualPeriod('2026-12-30')).toBeNull();
    expect(annualPeriod('2026-12-31')).toBe('2026-12-31');
    expect(annualPeriod('2027-01-31')).toBe('2026-12-31');
    expect(annualPeriod('2027-02-01')).toBeNull();
    expect(nextAnnualPeriod('2026-10-19')).toBe('2026-12-31');
    const e = inst.effectiveFor(annual, '2026-12-31', null);
    expect(e.publishAt.toISOString()).toBe('2026-12-31T16:00:00.000Z');
    expect(e.until.toISOString().slice(0, 10)).toBe('2027-01-31');
  });

  it('pushes once at 18:00 on Dec 31, not at 17:00', async () => {
    const db = memDb({ athletes: [athlete('dana', null)], story_instances: [] });
    const { d, sent } = deps();
    await runAnnualStoryPushes(db as never, new Date('2026-12-31T15:00:00Z'), ledger(), d);
    expect(sent).toEqual([]);
    await runAnnualStoryPushes(db as never, new Date('2026-12-31T16:05:00Z'), ledger(), d);
    await runAnnualStoryPushes(db as never, new Date('2026-12-31T16:10:00Z'), ledger(), d);
    expect(sent).toEqual(['dana']);
  });
});

describe('edge case: opted out', () => {
  it('the gate closes for the athlete (admin keeps a preview)', () => {
    const f = { paused: false, dbError: false, state: 'all' as const, athleteId: 'a', athleteActive: true, isTester: false, isAdmin: false, optedOut: true };
    expect(decideStoryGate(f)).toMatchObject({ allowed: false, reason: 'opted_out' });
    expect(decideStoryGate({ ...f, isAdmin: true })).toMatchObject({ allowed: true, preview: true });
  });
  it('storyGateMany drops opted-out athletes from the push', async () => {
    const db = memDb({
      app_settings: [{ key: 'stories_paused', value: 'off' }],
      story_feature_settings: [{ feature: 'birthday', state: 'all', send_push: true }],
      story_testers: [],
      athletes: [{ id: 'a', story_prefs: { birthday: false } }, { id: 'b', story_prefs: null }],
    });
    expect(Array.from(await storyGateMany('birthday', ['a', 'b'], { db: db as never }))).toEqual(['b']);
  });
  it('the public post honours its own opt-out and the overrides; it can never be widened', () => {
    expect(birthdayPostAllowed(birthday, true, null, null)).toBe(true);
    expect(birthdayPostAllowed(birthday, true, { birthday_feed_post: false }, null)).toBe(false);
    expect(birthdayPostAllowed(birthday, true, null, { feed_post: false })).toBe(false);
    expect(birthdayPostAllowed({ ...birthday, feed_post: false }, true, null, { feed_post: true })).toBe(false);
    expect(birthdayPostAllowed({ ...birthday, state: 'off' }, true, null, null)).toBe(false);
    expect(birthdayPostAllowed(birthday, false, null, null)).toBe(false);
    expect(parseStoryPrefs({ weekly: false, junk: 1 })).toEqual({ weekly: false });
  });
});

describe('edge case: override date in the past', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  it('is refused on save, except for an undo', () => {
    expect(inst.validateOverrides({ publish_at: '2026-10-18T10:00:00Z' }, now)).toMatchObject({ ok: false, error: 'publish_at in the past' });
    expect(inst.validateOverrides({ publish_at: '2026-10-18T10:00:00Z' }, now, { allowPast: true }).ok).toBe(true);
    expect(inst.validateOverrides({ display_days: 40 }, now).ok).toBe(false);
  });
  it('one that slipped through sends nothing past the grace', () => {
    const e = inst.effectiveFor(birthday, '2026-10-19', { publish_at: '2026-10-18T04:00:00Z' });
    expect(inst.pushDueAt(e, now, null)).toBe(false);
  });
  it('דחה למחר never lands in the past', () => {
    const e = inst.effectiveFor(birthday, '2026-10-10', null);
    expect(Date.parse(inst.quickAction('postpone', e, now).publish_at!)).toBeGreaterThan(now.getTime());
    expect(inst.quickAction('plus_day', inst.effectiveFor(birthday, '2026-10-19', { display_days: 31 }), now)).toEqual({ display_days: 31 });
    expect(inst.quickAction('skip_year', e, now)).toEqual({ skipped: true });
  });
});

describe('edge case: tester removed mid-window', () => {
  it('the story disappears on the next read', async () => {
    const weekly: Settings = { ...birthday, feature: 'weekly', state: 'testers' };
    let isTester = true;
    const accessDeps = {
      gate: async (_f: never, id: string | null) => decideStoryGate({ paused: false, dbError: false, state: 'testers', athleteId: id, athleteActive: true, isTester, isAdmin: false }),
      settings: async () => weekly,
      instance: async () => null,
    };
    const o = { viewerId: 'sahar', ownerId: 'sahar', isAdmin: false, period: '2026-10-17', now: new Date('2026-10-17T16:00:00Z') };
    expect((await storyAccess('weekly', o, accessDeps as never)).allowed).toBe(true);
    isTester = false;
    expect(await storyAccess('weekly', o, accessDeps as never)).toMatchObject({ allowed: false, reason: 'not_tester' });
  });
  it('another member cannot see a tester\'s story while it is in testing', async () => {
    const accessDeps = {
      gate: async (_f: never, id: string | null) => decideStoryGate({ paused: false, dbError: false, state: 'testers', athleteId: id, athleteActive: true, isTester: id === 'sahar', isAdmin: false }),
      settings: async () => birthday, instance: async () => null,
    };
    const r = await storyAccess('birthday', { viewerId: 'dana', ownerId: 'sahar', isAdmin: false, period: '2026-10-19', now: at0710 }, accessDeps as never);
    expect(r).toMatchObject({ allowed: false, reason: 'viewer_not_tester' });
  });
  it('off means off, for an admin preview too', async () => {
    const accessDeps = {
      gate: async (_f: never, id: string | null) => decideStoryGate({ paused: false, dbError: false, state: 'off', athleteId: id, athleteActive: true, isTester: true, isAdmin: true }),
      settings: async () => birthday, instance: async () => null,
    };
    expect((await storyAccess('birthday', { viewerId: 'boss', ownerId: 'dana', isAdmin: true, period: '2026-10-19', now: at0710, forcePreview: true }, accessDeps as never)).allowed).toBe(false);
  });
  it('outside the display window → closed; an override can only narrow', async () => {
    const accessDeps = (i: unknown) => ({
      gate: async (_f: never, id: string | null) => decideStoryGate({ paused: false, dbError: false, state: 'all', athleteId: id, athleteActive: true, isTester: false, isAdmin: false }),
      settings: async () => birthday, instance: async () => i,
    });
    const o = { viewerId: 'dana', ownerId: 'dana', isAdmin: false, period: '2026-10-19', now: new Date('2026-10-27T10:00:00Z') };
    expect((await storyAccess('birthday', o, accessDeps(null) as never)).reason).toBe('outside_window');
    expect((await storyAccess('birthday', o, accessDeps({ display_days: 14 }) as never)).allowed).toBe(true);
    expect((await storyAccess('birthday', { ...o, now: at0710 }, accessDeps({ enabled: false }) as never)).allowed).toBe(false);
  });
});

describe('edge case: view-as never sends a push or writes a mark', () => {
  it('assertNotPreview throws for a preview and a view-as', () => {
    expect(() => inst.assertNotPreview({ viewingAs: true })).toThrow();
    expect(() => inst.assertNotPreview({ preview: true })).toThrow();
    expect(() => inst.assertNotPreview({})).not.toThrow();
  });
  it('markSeen refuses a view-as', async () => {
    const db = memDb({ story_instances: [] });
    expect(await inst.markSeen(db as never, 'a', 'weekly', '2026-10-17', 'viewed_at', { preview: false, viewingAs: true })).toBe(false);
    expect(db.tables.story_instances).toHaveLength(0);
    expect(await inst.markSeen(db as never, 'a', 'weekly', '2026-10-17', 'viewed_at', { preview: false, viewingAs: false })).toBe(true);
    expect(db.tables.story_instances[0].viewed_at).toBeTruthy();
  });
});

describe('admin helpers', () => {
  it('Israel wall clock → UTC across DST', () => {
    expect(inst.israelWallToUtc('2026-10-19', '07:00').toISOString()).toBe('2026-10-19T04:00:00.000Z');
    expect(inst.israelWallToUtc('2026-12-31', '18:00').toISOString()).toBe('2026-12-31T16:00:00.000Z');
  });
  it('settingsPatch validates every field', () => {
    expect(settingsPatch({ state: 'all', generate_at: '07:30', display_days: 14, min_runs: 5, feed_post: true })).toMatchObject({ ok: true });
    expect(settingsPatch({ state: 'club' }).ok).toBe(false);
    expect(settingsPatch({ generate_at: '25:00' }).ok).toBe(false);
    expect(settingsPatch({}).ok).toBe(false);
  });
  it('rowStatus and buckets', () => {
    const p = { id: 'a', active: true, tester: false, optedOut: false };
    expect(rowStatus(birthday, false, '2026-10-20', p, null).status).toBe('ready');
    expect(rowStatus(birthday, true, '2026-10-20', p, null).status).toBe('paused');
    expect(rowStatus({ ...birthday, state: 'testers' }, false, '2026-10-20', p, null).status).toBe('not_tester');
    expect(rowStatus(birthday, false, '2026-10-20', { ...p, optedOut: true }, null).status).toBe('opted_out');
    expect(rowStatus(birthday, false, '2026-10-20', p, { skipped: true }).summary).toBe('דילוג השנה');
    expect(rowStatus(birthday, false, '2026-10-20', p, { display_days: 14 }).summary).toBe('מותאם: 14 ימים');
    expect(bucketOf('2026-10-19', '2026-10-19')).toBe('today');
    expect(bucketOf('2026-10-20', '2026-10-19')).toBe('tomorrow');
    expect(bucketOf('2026-10-24', '2026-10-19')).toBe('week');
    expect(nextSaturday('2026-10-19')).toBe('2026-10-24');
  });
});
