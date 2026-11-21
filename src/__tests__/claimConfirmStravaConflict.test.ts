// claim-member/confirm refuses, before any merge, when the roster row is already
// connected to a DIFFERENT Strava account. No false success, no overwrite.
// FIXTURE only: the DB is in memory and the merge is a spy.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

const db = createMemoryDb({
  schema: {
    athletes: ['id', 'name', 'email', 'strava_athlete_id'],
    athlete_claims: ['token', 'shell_athlete_id', 'target_athlete_id', 'sent_to', 'claimed_at', 'expires_at'],
  },
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db.client }));
const merges: unknown[] = [];
vi.mock('@/lib/auth/merge-athletes', () => ({ mergeAthleteRows: async (_a: unknown, x: unknown) => { merges.push(x); return { merged: true }; } }));

const TOKEN = 'a'.repeat(64);
const confirm = async () => {
  const { POST } = await import('@/app/api/auth/claim-member/confirm/route');
  const r = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ token: TOKEN }) }));
  return { status: r.status, body: await r.json() };
};
const seed = (realStrava: number | null) => {
  for (const t of Object.values(db.tables)) t.length = 0;
  merges.length = 0;
  db.tables.athletes.push(
    { id: 'real', name: 'Dana Fixture', email: 'dana.fixture@example.test', strava_athlete_id: realStrava },
    { id: 'shell', name: 'Dana Fixture', email: 'strava_9001@strava.madregot.local', strava_athlete_id: 9001 },
  );
  db.tables.athlete_claims.push({ token: TOKEN, shell_athlete_id: 'shell', target_athlete_id: 'real', sent_to: 'dana.fixture@example.test',
    claimed_at: null, expires_at: new Date(Date.now() + 600_000).toISOString() });
};

beforeEach(() => seed(null));

describe('claim confirm: Strava conflict', () => {
  it('roster row already linked to ANOTHER Strava id: 409 linked-to-other-strava, NO merge, X kept', async () => {
    seed(1234);
    expect(await confirm()).toEqual({ status: 409, body: { error: 'linked-to-other-strava' } });
    expect(merges).toHaveLength(0);
    expect(db.tables.athletes.find((a) => a.id === 'real')!.strava_athlete_id).toBe(1234);
  });
  it('roster row with NO Strava link: merges (the normal claim)', async () => {
    expect((await confirm()).status).toBe(200);
    expect(merges).toEqual([expect.objectContaining({ duplicateId: 'shell', realId: 'real' })]);
  });
  it('roster row already linked to the SAME Strava id: merges', async () => {
    seed(9001);
    expect((await confirm()).status).toBe(200);
    expect(merges).toHaveLength(1);
  });
  it('the token is single use: a second confirm is 410', async () => {
    await confirm();
    expect((await confirm()).status).toBe(410);
  });
});
