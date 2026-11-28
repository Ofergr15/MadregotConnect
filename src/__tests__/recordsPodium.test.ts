// Task 90: club records podium — top-3 per distance, shared places on ties, implausible
// manual entries kept off. Synthetic names/times only.
import { describe, it, expect, vi } from 'vitest';
import { podium, type PodiumInput } from '@/lib/records/podium';

const e = (id: string, seconds: number, o: Partial<PodiumInput> = {}): PodiumInput => ({ athleteId: id, name: `R ${id}`, seconds, date: '2026-10-01', source: 'auto', ...o });
const places = (rows: ReturnType<typeof podium>['rows']) => rows.map((r) => `${r.place}${r.tied ? '=' : ''}:${r.entry.athleteId}`);

describe('podium tie rules', () => {
  it('plain top three, fastest first', () => {
    expect(places(podium('10k', [e('c', 2600), e('a', 2400), e('d', 2700), e('b', 2500)]).rows)).toEqual(['1:a', '2:b', '3:c']);
  });
  it('a tie shares the place and skips the next (1, 1, 3)', () => {
    expect(places(podium('10k', [e('a', 2400), e('b', 2400), e('c', 2500), e('d', 2600)]).rows)).toEqual(['1=:a', '1=:b', '3:c']);
  });
  it('inside a tie, who ran it first is listed first; no date goes last', () => {
    const rows = podium('10k', [e('late', 2400, { date: '2026-11-01' }), e('nodate', 2400, { date: null }), e('early', 2400, { date: '2026-09-01' })]).rows;
    expect(rows.map((r) => r.entry.athleteId)).toEqual(['early', 'late', 'nodate']);
    expect(rows.every((r) => r.place === 1 && r.tied)).toBe(true);
  });
  it('everyone tied for third is on the podium', () => {
    expect(places(podium('10k', [e('a', 2400), e('b', 2500), e('c', 2600), e('d', 2600), e('x', 2700)]).rows)).toEqual(['1:a', '2:b', '3=:c', '3=:d']);
  });
  it('a three-way tie for second leaves no third', () => {
    expect(places(podium('10k', [e('a', 2400), e('b', 2500), e('c', 2500), e('d', 2500), e('x', 2600)]).rows)).toEqual(['1:a', '2=:b', '2=:c', '2=:d']);
  });
  it('fewer than three runners → a short podium; nobody → empty', () => {
    expect(podium('10k', [e('a', 2400)]).rows).toHaveLength(1);
    expect(podium('10k', [])).toEqual({ rows: [], excluded: 0 });
  });
});

describe('manual-entry validation', () => {
  it('an implausible stated time is excluded and counted; a plausible one stays', () => {
    const out = podium('10k', [e('typo', 252, { source: 'manual' }), e('ok', 2500, { source: 'manual' }), e('a', 2400)]);
    expect(out.excluded).toBe(1);
    expect(places(out.rows)).toEqual(['1:a', '2:ok']);
  });
  it('a broken time (0, NaN) is excluded whatever its source', () => {
    expect(podium('10k', [e('z', 0), e('n', Number.NaN), e('a', 2400)]).excluded).toBe(2);
  });
  it('an auto record is never second-guessed by the manual bounds', () => {
    expect(podium('10k', [e('fast', 1600)]).rows).toHaveLength(1);
  });
});

// Route: same gate and table as /api/club/records.
const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/prs/club-records-store', () => ({
  getClubRecords: async () => ({ snapshot: { computedAt: '2026-11-27T00:00:00Z', buckets: [{ key: '10k', label: '10K', meters: 10000, entries: [
    { athleteId: 'a', name: 'A', groupId: null, gender: 'male', seconds: 2400, date: '2026-10-01', activityId: 'x1', activityName: null, fromSegment: false, source: 'auto', note: null },
    { athleteId: 'hidden', name: 'H', groupId: null, gender: 'male', seconds: 2300, date: '2026-10-01', activityId: 'x2', activityName: null, fromSegment: false, source: 'auto', note: null },
  ] }] }, recomputed: false }),
}));
vi.mock('@/lib/records/server', () => ({
  readRoster: async () => [{ id: 'a', name: 'A', gender: 'male' }, { id: 'hidden', name: 'H', gender: 'male', leaderboardOptOut: true }],
  officialActivityIds: async () => new Set(['x1']),
}));
vi.mock('@/lib/records/board', () => ({
  filterRecordTable: (entries: Array<{ athleteId: string }>) => entries.filter((x) => x.athleteId !== 'hidden').map((entry, i) => ({ entry, rank: i + 1, official: true, ageBand: null })),
}));
const { GET } = await import('@/app/api/club/records/podium/route');

describe('GET /api/club/records/podium', () => {
  it('unsigned → the gate answers', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response(null, { status: 401 }), caller: {} });
    expect((await GET(new Request('http://x'))).status).toBe(401);
  });
  it("returns the filtered table's top three — a runner the table hides never appears", async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'a' } });
    const body = await (await GET(new Request('http://x'))).json();
    expect(body.podiums['10k'].rows).toEqual([expect.objectContaining({ place: 1, tied: false, athleteId: 'a', official: true })]);
    expect(JSON.stringify(body)).not.toContain('hidden');
  });
});
