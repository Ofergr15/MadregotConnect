import { beforeEach, describe, expect, it, vi } from 'vitest';

// /api/search leaked two things the feed already withholds:
// 1. a pending applicant (approved = false) in `members`;
// 2. a run's pace the runner hid in the share sheet (feed_items.payload.hiddenFields).
const today = new Date().toISOString();
const ATHLETES = [
  { id: 'me', name: 'Ofer Me', avatar_url: null, group_id: null, approved: true },
  { id: 'dana', name: 'Dana Active', avatar_url: null, group_id: null, approved: true },
  { id: 'dan', name: 'Dan Pending', avatar_url: null, group_id: null, approved: false },
];
const RUNS = [
  { id: 'r1', athlete_id: 'dana', start_time: today, activity_name: 'Tempo', distance: 10000, average_pace: 270, garmin_activity_id: 1, workout_title: null },
  { id: 'r2', athlete_id: 'me', start_time: today, activity_name: 'Tempo', distance: 8000, average_pace: 300, garmin_activity_id: 2, workout_title: null },
];
const FEED = [
  { activity_id: 'r1', payload: { hiddenFields: ['pace'] } },
  { activity_id: 'r2', payload: { hiddenFields: ['pace'] } },
];
const state = vi.hoisted(() => ({ feedError: false }));

function from(table: string) {
  const f: Record<string, unknown> = {};
  const rows = (): unknown[] => {
    if (table === 'athletes') {
      if (f.approved === false) return ATHLETES.filter((a) => a.approved === false);
      return f.in ? ATHLETES.filter((a) => (f.in as string[]).includes(a.id)) : ATHLETES;
    }
    if (table === 'athlete_activities') return RUNS;
    if (table === 'feed_items') return FEED.filter((x) => (f.in as string[]).includes(x.activity_id));
    return [];
  };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'ilike', 'or', 'order', 'limit', 'gte', 'neq']) b[m] = () => b;
  b.eq = (k: string, v: unknown) => { f[k] = v; return b; };
  b.in = (_k: string, v: unknown) => { f.in = v; return b; };
  b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  b.then = (ok: (v: unknown) => unknown) =>
    Promise.resolve(table === 'feed_items' && state.feedError ? { data: null, error: { message: 'x' } } : { data: rows(), error: null }).then(ok);
  return b;
}
const client = { from };
const who = vi.hoisted(() => ({ caller: {} as Record<string, unknown> }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => client }));
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller: who.caller }) }));
vi.mock('@/lib/photos/drive-browse', () => ({ THUMB: 480, signedImageUrl: () => '', listPhotoFolders: async () => [] }));
vi.mock('@/lib/photos/mirror', () => ({ mirroredUrls: async () => ({ thumb: {}, full: {}, lqip: {} }) }));
const { GET } = await import('@/app/api/search/route');
const { searchRuns } = await import('@/lib/search/runs');

beforeEach(() => { who.caller = { athleteId: 'me', isStaff: false, isSuperUser: false }; state.feedError = false; });
const paces = async (caller: Record<string, unknown>) =>
  Object.fromEntries((await searchRuns(client as never, 'Tempo', caller)).runs.map((h) => [h.id, h.pace]));

describe('search privacy', () => {
  it('members: a pending applicant is not found', async () => {
    const r = await (await GET(new Request('http://x/api/search?q=Dan'))).json();
    expect(r.members.map((m: { name: string }) => m.name)).toEqual(['Dana Active']);
  });
  it("runs: a teammate's hidden pace is null; my own stays", async () => {
    expect(await paces({ athleteId: 'me' })).toEqual({ r1: null, r2: 300 });
  });
  it('runs: staff still see the pace', async () => {
    expect((await paces({ athleteId: 'me', isStaff: true })).r1).toBe(270);
  });
  it('runs: a failed hidden-fields read hides the pace (fails closed)', async () => {
    state.feedError = true;
    expect(await paces({ athleteId: 'me' })).toEqual({ r1: null, r2: 300 });
  });
});
