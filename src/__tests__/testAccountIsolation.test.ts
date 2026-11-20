import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Test accounts (migration 182): a synthetic QA athlete can write without being
 * seen by — or notifying — other members. Its own content stays visible to itself
 * and to staff, and an unapplied migration changes nothing (fail open).
 */

const h = vi.hoisted(() => ({
  testIds: [] as string[],
  error: null as null | { code: string; message: string },
  sent: 0,
}));

const fakeDb = () => ({
  from: () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.in = () => q;
    q.limit = async () => ({ data: [], error: null });
    q.eq = (k: string) => {
      if (k === 'is_test_account') {
        return Promise.resolve(h.error ? { data: null, error: h.error } : { data: h.testIds.map((id) => ({ id, is_test_account: true })), error: null });
      }
      return q;
    };
    return q;
  },
});

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb() }));
vi.mock('@/lib/push', () => ({ notifyAthlete: async () => { h.sent++; } }));

import { testAccountIds, hiddenTestAccountsFor } from '@/lib/athletes/test-accounts';
import { withoutPendingAuthors } from '@/lib/auth/pending-athletes';
import { notifyFeedInteraction } from '@/lib/feed/notify';

const db = () => fakeDb() as unknown as SupabaseClient;

beforeEach(() => { h.testIds = []; h.error = null; h.sent = 0; });

describe('testAccountIds', () => {
  it('reads flagged athletes', async () => {
    h.testIds = ['qa'];
    expect([...await testAccountIds(db())]).toEqual(['qa']);
  });

  it('is empty when the column is missing (migration not applied)', async () => {
    h.error = { code: '42703', message: 'column athletes.is_test_account does not exist' };
    expect((await testAccountIds(db())).size).toBe(0);
  });

  it('is empty on any other read error', async () => {
    h.error = { code: '500', message: 'boom' };
    expect((await testAccountIds(db())).size).toBe(0);
  });
});

describe('feed filtering', () => {
  const rows = [
    { id: 'a', author_athlete_id: 'qa' },
    { id: 'b', author_athlete_id: 'dana' },
    { id: 'c', author_athlete_id: null },
  ];
  const visible = (viewer: { athleteId?: string; isStaff?: boolean }) =>
    withoutPendingAuthors(rows, hiddenTestAccountsFor(new Set(['qa']), viewer)).map((r) => r.id);

  it('a member does not see a test account', () => {
    expect(visible({ athleteId: 'dana' })).toEqual(['b', 'c']);
  });
  it('the test account sees itself', () => {
    expect(visible({ athleteId: 'qa' })).toEqual(['a', 'b', 'c']);
  });
  it('staff see it', () => {
    expect(visible({ athleteId: 'coach', isStaff: true })).toEqual(['a', 'b', 'c']);
  });
  it('the feed route applies it through the pending-author filter', () => {
    const src = readFileSync('src/app/api/feed/route.ts', 'utf8');
    expect(src).toMatch(/hiddenTestAccountsFor\(await testRead, auth\.user\)\) pending\.add/);
  });
});

describe('notification suppression', () => {
  const like = (actor: string) => notifyFeedInteraction({
    feedItemId: 'i1', authorAthleteId: 'dana', actorAthleteId: actor, actorName: actor, kind: 'like', itemType: 'activity',
  });

  it('a test account liking a member does not notify them', async () => {
    h.testIds = ['qa'];
    await like('qa');
    expect(h.sent).toBe(0);
  });
  it('a real member still notifies', async () => {
    h.testIds = ['qa'];
    await like('omer');
    expect(h.sent).toBe(1);
  });
  it('the teammate-activity push checks the flag', () => {
    const src = readFileSync('src/lib/push.ts', 'utf8');
    expect(src).toMatch(/if \(await isTestAccount\(supabase, activity\.athleteId\)\) return 0;/);
  });
});
