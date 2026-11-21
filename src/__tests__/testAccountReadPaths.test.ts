import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hiddenFromCaller, hiddenTestAccountsFor } from '@/lib/athletes/test-accounts';

/**
 * Test accounts (migration 182) on the per-athlete read paths and the member-facing
 * aggregates: hidden from other members, visible to themselves and staff, and an
 * unapplied migration changes nothing. See docs/contracts/test-account-isolation.md.
 */

const h = { testIds: [] as string[], pending: [] as string[], missingColumn: false };

const fakeDb = () => ({
  from: () => {
    let id = '';
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (k: string, v: unknown) => {
      if (k === 'is_test_account') {
        return Promise.resolve(h.missingColumn
          ? { data: null, error: { code: '42703', message: 'column athletes.is_test_account does not exist' } }
          : { data: h.testIds.map((t) => ({ id: t, is_test_account: true })), error: null });
      }
      if (k === 'id') id = String(v);
      return q;
    };
    q.maybeSingle = async () => ({ data: { approved: !h.pending.includes(id) }, error: null });
    return q;
  },
});
const db = () => fakeDb() as unknown as SupabaseClient;

beforeEach(() => { h.testIds = ['qa']; h.pending = []; h.missingColumn = false; });

describe('hiddenFromCaller (per-athlete reads: feed item, run detail, profile, runs, stats, badges)', () => {
  it('hides a test account from another member', async () => {
    expect(await hiddenFromCaller(db(), { athleteId: 'dana' }, 'qa')).toBe(true);
  });
  it('shows the test account to itself', async () => {
    expect(await hiddenFromCaller(db(), { athleteId: 'qa' }, 'qa')).toBe(false);
  });
  it('shows it to staff', async () => {
    expect(await hiddenFromCaller(db(), { athleteId: 'coach', isStaff: true }, 'qa')).toBe(false);
  });
  it('leaves a real member visible', async () => {
    expect(await hiddenFromCaller(db(), { athleteId: 'dana' }, 'omer')).toBe(false);
  });
  it('still hides a pending runner (#77 rule kept)', async () => {
    h.pending = ['newbie'];
    expect(await hiddenFromCaller(db(), { athleteId: 'dana' }, 'newbie')).toBe(true);
  });
  it('fails open when the column is missing', async () => {
    h.missingColumn = true;
    expect(await hiddenFromCaller(db(), { athleteId: 'dana' }, 'qa')).toBe(false);
  });
});

describe('aggregate filtering (member / self / staff)', () => {
  const rows = [{ athleteId: 'qa' }, { athleteId: 'dana' }];
  const seen = (viewer: { athleteId?: string; isStaff?: boolean }) => {
    const hidden = hiddenTestAccountsFor(new Set(['qa']), viewer);
    return rows.filter((r) => !hidden.has(r.athleteId)).map((r) => r.athleteId);
  };
  it('member', () => expect(seen({ athleteId: 'dana' })).toEqual(['dana']));
  it('self', () => expect(seen({ athleteId: 'qa' })).toEqual(['qa', 'dana']));
  it('staff', () => expect(seen({ athleteId: 'c', isStaff: true })).toEqual(['qa', 'dana']));
});

describe('routes apply the gate', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it.each([
    'src/app/api/feed/items/[id]/route.ts',
    'src/app/api/activities/details/route.ts',
    'src/app/api/activities/stream/route.ts',
    'src/app/api/activities/analysis/route.ts',
    'src/app/api/athletes/[id]/runs/route.ts',
    'src/app/api/athletes/[id]/stats/route.ts',
    'src/app/api/athletes/[id]/records/run/[activityId]/route.ts',
    'src/app/api/athletes/badges/route.ts',
  ])('%s uses hiddenFromCaller', (p) => {
    expect(src(p)).toMatch(/hiddenFromCaller\(/);
  });
  it.each([
    'src/app/api/athletes/[id]/connections/route.ts',
    'src/app/api/athletes/discover/route.ts',
    'src/app/api/athletes/route.ts',
    'src/app/api/search/route.ts',
    'src/lib/search/runs.ts',
    'src/app/api/club/today/route.ts',
    'src/app/api/club/champions/route.ts',
    'src/app/api/surveys/[id]/route.ts',
  ])('%s filters with hiddenTestAccountsFor', (p) => {
    expect(src(p)).toMatch(/hiddenTestAccountsFor\(/);
  });
  it('public profile checks the flag', () => {
    expect(src('src/app/api/athletes/[id]/public/route.ts')).toMatch(/isTestAccount\(supabase, id\)/);
  });
  it('segments checks the flag on the by-activity path', () => {
    expect(src('src/app/api/academy/segments/route.ts')).toMatch(/isTestAccount\(createServerClient\(\), athleteId\)/);
  });
});
