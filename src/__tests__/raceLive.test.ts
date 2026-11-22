import { describe, it, expect, vi, beforeEach } from 'vitest';

// The send path is mocked: these tests pin WHO is asked and how often, not web-push itself.
const sent: { to: string[]; title: string; body: string; tag?: string }[] = [];
vi.mock('@/lib/push', () => ({
  subscriptionsForAthletes: async (ids: string[]) => ids.map((id) => ({ id: `s-${id}`, athlete_id: id })),
  sendPushLocalized: async (subs: { athlete_id: string }[], build: (l: string) => any) => {
    const p = build('he');
    sent.push({ to: subs.map((s) => s.athlete_id), title: p.title, body: p.body, tag: p.tag });
    return { sent: subs.length, byAthlete: Object.fromEntries(subs.map((s) => [s.athlete_id, 1])) };
  },
  persistNotifications: async () => {},
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('use fake db'); } }));

import {
  cleanSplits, mapFeedToEntries, milestonesToSend, normalizeBib, normalizeFeedBody, parseClock,
  pointFromLabel, predictFinishSec, recipientsFor, shouldPoll, formatClock,
} from '@/lib/race-live/core';
import { profileSplits, REPLAY_PROFILES, replayFeedAt } from '@/lib/race-live/replay';
import { raceLiveTick, liveBoard } from '@/lib/race-live/server';

// ─── a tiny in-memory Supabase ───────────────────────────────────────────────
const PKS: Record<string, string[]> = {
  race_live_config: ['event_id'],
  race_entries: ['event_id', 'athlete_id'],
  race_splits: ['event_id', 'athlete_id', 'point'],
  race_milestones: ['event_id', 'athlete_id', 'milestone'],
};
function fakeDb(tables: Record<string, any[]>) {
  const T = (n: string) => (tables[n] ??= []);
  const pick = (row: any, path: string) => (path.includes('->>') ? row[path.split('->>')[0]]?.[path.split('->>')[1]] : row[path]);
  function q(name: string) {
    const filters: ((r: any) => boolean)[] = [];
    let op: 'select' | 'update' | 'delete' | 'upsert' | 'insert' = 'select';
    let payload: any = null;
    let opts: any = {};
    let returned: any[] | null = null;
    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => (filters.push((r) => pick(r, k) === v), api),
      in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), api),
      limit: () => api,
      update: (p: any) => ((op = 'update'), (payload = p), api),
      delete: () => ((op = 'delete'), api),
      insert: (p: any) => ((op = 'insert'), (payload = p), api),
      upsert: (p: any, o: any) => ((op = 'upsert'), (payload = p), (opts = o || {}), api),
      maybeSingle: () => run().then((r: any) => ({ data: r.data?.[0] ?? null, error: null })),
      then: (res: any, rej: any) => run().then(res, rej),
    };
    async function run() {
      const rows = T(name);
      const match = (r: any) => filters.every((f) => f(r));
      if (op === 'select') return { data: rows.filter(match), error: null };
      if (op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      if (op === 'delete') { tables[name] = rows.filter((r) => !match(r)); return { data: null, error: null }; }
      if (op === 'insert') { [].concat(payload).forEach((p: any) => rows.push({ ...p })); return { data: null, error: null }; }
      const pk = PKS[name];
      returned = [];
      for (const p of [].concat(payload) as any[]) {
        const hit = rows.find((r) => pk.every((k) => r[k] === p[k]));
        if (hit) { if (!opts.ignoreDuplicates) { Object.assign(hit, p); returned.push(hit); } }
        else { rows.push({ ...p }); returned.push(p); }
      }
      return { data: returned, error: null };
    }
    return api;
  }
  return { from: q, tables } as any;
}

const EVENT = 'ev-valencia';
const RUNNERS = ['r1', 'r2', 'r3', 'r4'];

function seed(opts: { optOut?: string[]; push?: boolean } = {}) {
  return fakeDb({
    race_live_config: [{ event_id: EVENT, source: 'replay', feed_url: null, active: true, push_enabled: opts.push ?? true, poll_from: null, poll_to: null, poll_every_sec: 60, last_polled_at: null, fail_count: 0, replay_started_at: new Date(0).toISOString(), replay_speed: 1 }],
    race_entries: RUNNERS.map((id, i) => ({ event_id: EVENT, athlete_id: id, bib: String(1000 + i), live_opt_out: !!opts.optOut?.includes(id), goal_sec: null })),
    athletes: [...RUNNERS, 'fan1', 'fan2', 'offFan'].map((id) => ({ id, name: `שם ${id}`, role: 'runner', group_id: null, is_academy: false })),
    // race_live ON for every athlete except offFan
    feature_enablements: [
      { feature: 'race_live', scope_type: 'club', scope_id: '*', enabled: true },
      { feature: 'race_live', scope_type: 'athlete', scope_id: 'offFan', enabled: false },
    ],
    athlete_follows: [{ follower_id: 'fan1', followee_id: 'r1' }, { follower_id: 'offFan', followee_id: 'r1' }, { follower_id: 'r2', followee_id: 'r1' }],
    feed_items: [],
    event_group_assignments: [],
  });
}

beforeEach(() => { sent.length = 0; });

describe('parsing + mapping', () => {
  it('reads clocks and labels the way timing feeds write them', () => {
    expect(parseClock('2:58:41')).toBe(10721);
    expect(parseClock('58:41')).toBe(3521);
    expect(parseClock('02:58:41.37')).toBe(10721);
    expect(parseClock('2:61:00')).toBeNull();
    expect(pointFromLabel('Km 5')).toBe('5k');
    expect(pointFromLabel('MEDIA')).toBe('half');
    expect(pointFromLabel('21K')).toBe('half');
    expect(pointFromLabel('Meta')).toBe('finish');
    expect(pointFromLabel('banana')).toBeNull();
    expect(formatClock(10721)).toBe('2:58:41');
  });

  it('matches bibs ignoring leading zeros and whitespace', () => {
    expect(normalizeBib(' 08123 ')).toBe('8123');
    const m = mapFeedToEntries([{ bib: '08123', splits: [{ point: '5k', elapsedSec: 1200 }] }, { bib: '999', splits: [] }], [{ athleteId: 'a', bib: '8123', optOut: false }]);
    expect([...m.keys()]).toEqual(['a']);
  });

  it('drops an opted-out runner before anything is stored', () => {
    const m = mapFeedToEntries([{ bib: '1', splits: [{ point: '5k', elapsedSec: 1200 }] }], [{ athleteId: 'a', bib: '1', optOut: true }]);
    expect(m.size).toBe(0);
  });

  it('discards splits that run backwards in time', () => {
    expect(cleanSplits([{ point: '5k', elapsedSec: 1200 }, { point: '10k', elapsedSec: 1100 }, { point: '15k', elapsedSec: 3600 }]).map((s) => s.point)).toEqual(['5k', '15k']);
  });

  it('normalises the common feed shapes', () => {
    const a = normalizeFeedBody({ data: [{ dorsal: '0042', splits: [{ name: '5K', time: '0:20:10' }, { name: 'Media', time: '1:25:00' }] }] });
    expect(a[0].bib).toBe('42');
    expect(a[0].splits.map((s) => s.point)).toEqual(['start', '5k', 'half']);
    const b = normalizeFeedBody({ bib: 7, times: { '10K': '40:00' }, chipTime: '2:59:59' });
    expect(b[0].splits.map((s) => s.point)).toEqual(['start', '10k', 'finish']);
  });

  it('predicts nothing before 5 km and the chip time once finished', () => {
    expect(predictFinishSec([{ point: 'start', elapsedSec: 0 }])).toBeNull();
    const half = predictFinishSec([{ point: 'half', elapsedSec: 5400 }])!;
    expect(half).toBeGreaterThan(10800); // fades past an even split
    expect(predictFinishSec([{ point: 'finish', elapsedSec: 10721 }])).toBe(10721);
  });
});

describe('milestone dedup', () => {
  it('announces the furthest new milestone only and marks the rest silent', () => {
    const s = [{ point: 'start', elapsedSec: 0 }, { point: 'half', elapsedSec: 5000 }, { point: 'finish', elapsedSec: 10500 }] as const;
    expect(milestonesToSend([...s], [])).toEqual({ send: 'finish', silent: ['start', 'half'] });
    expect(milestonesToSend([...s], ['start', 'half', 'finish'])).toEqual({ send: null, silent: [] });
    expect(milestonesToSend([{ point: 'start', elapsedSec: 0 }, { point: '5k', elapsedSec: 1200 }], ['start'])).toEqual({ send: null, silent: [] });
  });
});

describe('push fan-out', () => {
  const base = { runnerId: 'r', runnerOptOut: false, followerIds: ['f1', 'f2', 'r'], enabledMemberIds: ['f1', 'f2', 'm1', 'r'] };
  it('start and half go to followers only', () => {
    expect(recipientsFor({ ...base, milestone: 'half' }).sort()).toEqual(['f1', 'f2']);
  });
  it('finish goes to followers plus every enabled member, never the runner', () => {
    expect(recipientsFor({ ...base, milestone: 'finish' }).sort()).toEqual(['f1', 'f2', 'm1']);
  });
  it('skips anyone the feature is off for, and everyone when the runner opted out', () => {
    expect(recipientsFor({ ...base, milestone: 'finish', enabledMemberIds: ['f1'] })).toEqual(['f1']);
    expect(recipientsFor({ ...base, milestone: 'finish', runnerOptOut: true })).toEqual([]);
  });
});

describe('poll schedule', () => {
  it('polls every minute in the window, backs off on failure, never outside it', () => {
    const w = { fromMs: 0, toMs: 10 * 3600e3 };
    expect(shouldPoll({ ...w, nowMs: 60e3, lastPolledMs: null, failCount: 0 })).toBe(true);
    expect(shouldPoll({ ...w, nowMs: 90e3, lastPolledMs: 60e3, failCount: 0 })).toBe(false);
    expect(shouldPoll({ ...w, nowMs: 121e3, lastPolledMs: 60e3, failCount: 0 })).toBe(true);
    expect(shouldPoll({ ...w, nowMs: 121e3, lastPolledMs: 60e3, failCount: 2 })).toBe(false); // 4 min
    expect(shouldPoll({ ...w, nowMs: 11 * 3600e3, lastPolledMs: null, failCount: 0 })).toBe(false);
  });
});

describe('replay dry run (whole path: feed → store → claim → push → feed card)', () => {
  it('replays a race end-to-end with exactly one push per milestone per runner', async () => {
    const db = seed();
    const bibs = RUNNERS.map((_, i) => String(1000 + i));
    const longest = Math.max(...REPLAY_PROFILES.map((p) => p.finishSec + p.startOffsetSec));
    // Poll every 60 race-seconds for the whole race, plus overlapping duplicate ticks.
    for (let t = 0; t <= longest + 120; t += 60) {
      await raceLiveTick({ db, nowMs: t * 1000, force: true });
      if (t % 600 === 0) await raceLiveTick({ db, nowMs: t * 1000, force: true }); // a doubled cron
    }
    const tags = sent.map((s) => s.tag);
    expect(new Set(tags).size).toBe(tags.length); // never twice
    // r1..r4 all finish → 12 milestones claimed. Only r1 has followers, so start/half push for
    // r1 alone; finish reaches the club for all four → 3 + 3 sends.
    expect(db.tables.race_milestones).toHaveLength(12);
    expect(sent.length).toBe(6);
    const r1Finish = sent.find((s) => s.tag === `race-${EVENT}-r1-finish`)!;
    expect(r1Finish.body).toBe(`שם r1 סיים/ה ב-${formatClock(profileSplits(REPLAY_PROFILES[0]).at(-1)!.elapsedSec)} 🎉`);
    expect(r1Finish.to).not.toContain('r1');
    expect(r1Finish.to).not.toContain('offFan');
    expect(r1Finish.to).toContain('fan2'); // finish reaches the whole enabled club
    const r1Half = sent.find((s) => s.tag === `race-${EVENT}-r1-half`)!;
    expect(r1Half.to.sort()).toEqual(['fan1', 'r2']); // half: followers only
    // A finisher card per runner, once.
    expect(db.tables.feed_items.filter((f: any) => f.payload?.kind === 'race_result')).toHaveLength(4);
    expect(replayFeedAt(bibs, 0).every((r) => r.splits.length <= 1)).toBe(true);
    if (process.env.RACE_REPLAY_REPORT) {
      (await import("node:fs")).writeFileSync(process.env.RACE_REPLAY_REPORT, JSON.stringify({
        splitsStored: db.tables.race_splits.length,
        milestones: db.tables.race_milestones.map((m: any) => `${m.athlete_id}:${m.milestone}:${m.sent ? 'sent' : 'silent'}`),
        pushes: sent.map((s) => ({ tag: s.tag, to: s.to.length, body: s.body })),
        feedCards: db.tables.feed_items.map((f: any) => `${f.author_athlete_id} ${f.body}`),
      }, null, 1));
    }
  });

  it('an opted-out runner is never stored, announced or shown to others', async () => {
    const db = seed({ optOut: ['r1'] });
    for (let t = 0; t <= 4 * 3600; t += 300) await raceLiveTick({ db, nowMs: t * 1000, force: true });
    expect(db.tables.race_splits.some((s: any) => s.athlete_id === 'r1')).toBe(false);
    expect(sent.some((s) => s.tag?.includes('-r1-'))).toBe(false);
    const board = await liveBoard(db, EVENT, 'fan1');
    expect(board.runners.map((r) => r.athleteId)).not.toContain('r1');
    const own = await liveBoard(db, EVENT, 'r1');
    expect(own.runners.find((r) => r.athleteId === 'r1')?.isSelf).toBe(true);
  });

  it('a rehearsal with push off stores and claims but sends nothing', async () => {
    const db = seed({ push: false });
    for (let t = 0; t <= 4 * 3600; t += 600) await raceLiveTick({ db, nowMs: t * 1000, force: true });
    expect(sent).toHaveLength(0);
    expect(db.tables.race_milestones.length).toBeGreaterThan(0);
  });

  it('a feed that refuses us backs off instead of hammering', async () => {
    const db = seed();
    db.tables.race_live_config[0].source = 'feed';
    db.tables.race_live_config[0].feed_url = 'https://example.test/r?bib={bib}';
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response('', { status: 429 }); }) as any;
    await raceLiveTick({ db, nowMs: 0, fetcher, force: true });
    expect(calls).toBe(1); // stopped at the first refusal, not once per bib
    expect(db.tables.race_live_config[0].fail_count).toBe(1);
  });
});
