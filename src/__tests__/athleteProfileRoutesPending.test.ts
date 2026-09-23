import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * `/api/athletes/[id]/public` and `/connections` — the teammate page's two reads.
 *
 * Both answered anyone who had an id, signed in or not, and both showed a runner
 * still waiting for approval to the whole club (#77, #86). Now: members only, a
 * pending runner is a 404 to a teammate, and drops out of everyone's follow lists.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { athletes: [], athlete_follows: [], groups: [] };

class Query implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: Array<(r: Row) => boolean> = [];
  constructor(private table: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push(r => vs.includes(r[c])); return this; }
  private rows() { return db[this.table].filter(r => this.filters.every(f => f(r))); }
  maybeSingle() { return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  then<A, B>(ok?: ((v: { data: Row[]; error: null }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve({ data: this.rows(), error: null as null }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Query(t) }) }));

const { GET: getPublic } = await import('@/app/api/athletes/[id]/public/route');
const { GET: getConnections } = await import('@/app/api/athletes/[id]/connections/route');

const as = (caller: Row | null) =>
  resolveVerifiedCaller.mockResolvedValue(
    caller
      ? { denied: null, caller: { isStaff: false, athleteId: null, ...caller } }
      : { denied: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), caller: {} },
  );
const req = () => new Request('http://x/api');
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  db.athletes = [
    { id: 'me', name: 'Me', approved: true },
    { id: 'mate', name: 'Mate', approved: null },
    { id: 'pend', name: 'Pending', approved: false },
  ];
  db.athlete_follows = [
    { follower_id: 'mate', followee_id: 'me' },
    { follower_id: 'pend', followee_id: 'me' },
    { follower_id: 'me', followee_id: 'pend' },
  ];
});

describe('public profile', () => {
  it('signed out gets the 401, not the profile', async () => {
    as(null);
    expect((await getPublic(req(), ctx('mate'))).status).toBe(401);
  });

  it('a pending runner is a 404 to a teammate, and there to themselves and staff', async () => {
    as({ athleteId: 'me' });
    expect((await getPublic(req(), ctx('pend'))).status).toBe(404);
    expect((await getPublic(req(), ctx('mate'))).status).toBe(200);
    as({ athleteId: 'pend' });
    expect((await getPublic(req(), ctx('pend'))).status).toBe(200);
    as({ athleteId: 'coach', isStaff: true });
    const res = await getPublic(req(), ctx('pend'));
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('approved');
  });
});

describe('connections', () => {
  const names = (list: Array<{ name: string }>) => list.map(a => a.name);

  it('signed out gets the 401', async () => {
    as(null);
    expect((await getConnections(req(), ctx('me'))).status).toBe(401);
  });

  it('a teammate never sees the pending runner in either list', async () => {
    as({ athleteId: 'mate' });
    const body = await (await getConnections(req(), ctx('me'))).json();
    expect(names(body.followers)).toEqual(['Mate']);
    expect(names(body.following)).toEqual([]);
    expect((await getConnections(req(), ctx('pend'))).status).toBe(404);
  });

  it('staff still see them', async () => {
    as({ athleteId: 'coach', isStaff: true });
    const body = await (await getConnections(req(), ctx('me'))).json();
    expect(names(body.followers).sort()).toEqual(['Mate', 'Pending']);
  });

  it('the viewer is the session, not ?viewerId=', async () => {
    as({ athleteId: 'mate' });
    const body = await (await getConnections(new Request('http://x/api?viewerId=me'), ctx('me'))).json();
    const spoofed = await (await getConnections(new Request('http://x/api'), ctx('me'))).json();
    expect(body.isFollowing).toBe(true);
    expect(body).toEqual(spoofed);
  });
});
