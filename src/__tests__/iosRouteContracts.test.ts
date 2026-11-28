import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { breakingChanges, contractBreaks, validate, type ContractFile, type Schema } from '@/lib/contracts/json-schema';
import { IOS_CONTRACT, expectIosContract } from './helpers/ios-contract';

/**
 * The iOS app's API contract (task 197).
 *
 *  1. docs/contracts/ios-routes.json lists the 20 routes the app calls, each with
 *     a JSON Schema for its 2xx body.
 *  2. It may only GROW against docs/contracts/ios-routes.baseline.json — removing
 *     a field, widening a type, making something optional or adding an enum value
 *     breaks an installed app (Swift Codable decodes strictly), so it fails here.
 *     Accepting a break on purpose = coordinate a native release, then
 *     `cp docs/contracts/ios-routes.json docs/contracts/ios-routes.baseline.json`.
 *  3. Real handlers are run against the schema here (version, public groups,
 *     likes, comments, plan weeks, unread) and in the per-route contract tests
 *     (feed, like, plans/week, dashboard/weekly, inbox, activity details, device
 *     register) via expectIosContract().
 */

const BASELINE: ContractFile = JSON.parse(readFileSync(join(process.cwd(), 'docs/contracts/ios-routes.baseline.json'), 'utf8'));

describe('iOS contract file', () => {
  it('covers exactly 20 routes', () => {
    expect(Object.keys(IOS_CONTRACT.routes)).toHaveLength(20);
  });

  it.each(Object.entries(IOS_CONTRACT.routes))('%s → the route file exists and exports its method', (_id, route) => {
    const file = join(process.cwd(), 'src/app/api', route.path.replace(/^\/api\//, ''), 'route.ts');
    expect(existsSync(file), file).toBe(true);
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(new RegExp(`export (async )?(function|const) ${route.method}\\b`));
  });

  it('every $ref resolves', () => {
    const refs = JSON.stringify(IOS_CONTRACT).match(/"\$ref":"#\/\$defs\/([A-Za-z]+)"/g) ?? [];
    for (const r of refs) expect(IOS_CONTRACT.$defs[r.split('/').pop()!.replace('"', '')]).toBeDefined();
  });

  it('has no breaking change against the baseline the shipped app was built on', () => {
    expect(contractBreaks(BASELINE, IOS_CONTRACT)).toEqual([]);
  });
});

describe('breakingChanges()', () => {
  const base: Schema = {
    type: 'object',
    required: ['id', 'state'],
    properties: { id: { type: 'string' }, state: { type: 'string', enum: ['ok', 'none'] }, note: { type: ['string', 'null'] } },
  };
  const edit = (patch: (s: Schema) => void): Schema => {
    const s = structuredClone(base);
    patch(s);
    return s;
  };

  it('additions are safe: new optional field, new required field, narrower type, fewer enum values', () => {
    expect(breakingChanges(base, edit((s) => { s.properties!.extra = { type: 'number' }; }), {}, {})).toEqual([]);
    expect(breakingChanges(base, edit((s) => { s.required!.push('note'); }), {}, {})).toEqual([]);
    expect(breakingChanges(base, edit((s) => { s.properties!.note = { type: 'string' }; }), {}, {})).toEqual([]);
    expect(breakingChanges(base, edit((s) => { s.properties!.state.enum = ['ok']; }), {}, {})).toEqual([]);
  });

  it('flags a removed field, a dropped requirement, a widened type and a new enum value', () => {
    expect(breakingChanges(base, edit((s) => { delete s.properties!.note; }), {}, {})).toEqual(['$.note: property removed']);
    expect(breakingChanges(base, edit((s) => { s.required = ['id']; }), {}, {})).toEqual(['$.state: no longer required']);
    expect(breakingChanges(base, edit((s) => { s.properties!.id = { type: ['string', 'null'] }; }), {}, {})).toEqual(['$.id: type widened string -> string|null']);
    expect(breakingChanges(base, edit((s) => { s.properties!.state.enum = ['ok', 'none', 'paused']; }), {}, {})).toEqual(['$.state: new enum value "paused"']);
  });

  it('follows $ref and array items', () => {
    const defs = { Row: base };
    const list: Schema = { type: 'array', items: { $ref: '#/$defs/Row' } };
    const broken = { Row: edit((s) => { delete s.properties!.id; }) };
    expect(breakingChanges(list, list, defs, broken)).toEqual(['$[].id: property removed']);
  });

  it('a removed or moved route is breaking', () => {
    const next = structuredClone(BASELINE);
    delete next.routes.version;
    next.routes.feed.path = '/api/feed2';
    expect(contractBreaks(BASELINE, next)).toEqual(['feed: moved GET /api/feed -> GET /api/feed2', 'version: route contract removed']);
  });
});

describe('validate()', () => {
  it('reports the path of a missing, mistyped or out-of-enum field', () => {
    const s = IOS_CONTRACT.routes['public.groups'].response;
    expect(validate(s, { groups: [{ id: 'g', name: 'x', index: 0, paceOffsetSeconds: 0, level: 'fast' }] }, IOS_CONTRACT.$defs)).toEqual([]);
    expect(validate(s, { groups: [{ id: 1, name: 'x', index: 0, level: 'turbo' }] }, IOS_CONTRACT.$defs)).toEqual([
      '$.groups[0].paceOffsetSeconds: required, missing',
      '$.groups[0].id: expected string, got integer',
      '$.groups[0].level: "turbo" not in enum ["fast","medium","slow"]',
    ]);
  });
});

// ---- real handlers ---------------------------------------------------------

const ME = '11111111-1111-4111-8111-111111111111';
let tableRows: Record<string, unknown[]> = {};
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const result = () => ({ data: tableRows[table] ?? [], error: null });
      const c: any = {};
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[m] = () => c;
      c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
      return c;
    },
  }),
}));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireSession: async () => ({ ok: true, user: { athleteId: ME, isStaff: false, role: 'runner' } }),
}));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  requireMember: async () => null,
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: ME, isStaff: false, isSuperUser: false, role: 'runner' } }),
}));
vi.mock('@/lib/feed/test-account-filter', async (orig) => ({
  ...(await orig<object>()),
  hiddenInteractorsFor: async () => new Set(),
}));
vi.mock('@/lib/moderation/blocks', () => ({ blockedAuthorIds: async () => new Set() }));
vi.mock('@/lib/push', () => ({ unreadCountForAthlete: async () => 3 }));

const get = (path: string) => new Request(`http://x${path}`, { headers: { authorization: 'Bearer t' } });
const bodyOf = async (res: Response) => {
  expect(res.status).toBe(200);
  return res.json();
};

describe('real handlers fit the iOS contract', () => {
  beforeEach(() => { tableRows = {}; });

  it('GET /api/version', async () => {
    const { GET } = await import('@/app/api/version/route');
    expectIosContract('version', await bodyOf(GET()));
  });

  it('GET /api/public/groups', async () => {
    tableRows.groups = [{ id: 'g1', name: 'Group 1', pace_profile: { offsetSeconds: 0 } }, { id: 'g3', name: 'Group 3', pace_profile: null }];
    const { GET } = await import('@/app/api/public/groups/route');
    const body = await bodyOf(await GET());
    expect(body.groups).toHaveLength(2);
    expectIosContract('public.groups', body);
  });

  it('GET /api/feed/likes', async () => {
    tableRows.feed_likes = [{ feed_item_id: 'fi', created_at: '2026-11-20T10:00:00Z', athletes: { id: ME, name: 'אני', avatar_url: null } }];
    const { GET } = await import('@/app/api/feed/likes/route');
    const body = await bodyOf(await GET(get('/api/feed/likes?itemId=fi')));
    expect(body.likers).toHaveLength(1);
    expectIosContract('feed.likes', body);
  });

  it('GET /api/feed/comments', async () => {
    tableRows.feed_comments = [{ id: 'c1', feed_item_id: 'fi', athlete_id: ME, body: 'יפה', created_at: '2026-11-20T10:00:00Z', athletes: { id: ME, name: 'אני', avatar_url: null } }];
    const { GET } = await import('@/app/api/feed/comments/route');
    const body = await bodyOf(await GET(get('/api/feed/comments?itemId=fi')));
    expect(body.comments).toHaveLength(1);
    expectIosContract('feed.comments', body);
  });

  it('GET /api/plans/weeks', async () => {
    tableRows.weekly_plans = [{ week_start_date: '2026-11-22' }, { week_start_date: '2026-11-22' }, { week_start_date: '2026-11-15' }];
    const { GET } = await import('@/app/api/plans/weeks/route');
    const body = await bodyOf(await GET(get('/api/plans/weeks')));
    expect(body.weekStarts).toEqual(['2026-11-22', '2026-11-15']);
    expectIosContract('plans.weeks', body);
  });

  it('GET /api/notifications/unread', async () => {
    const { GET } = await import('@/app/api/notifications/unread/route');
    const body = await bodyOf(await GET(get(`/api/notifications/unread?athleteId=${ME}`)));
    expect(body).toEqual({ count: 3 });
    expectIosContract('notifications.unread', body);
  });
});
