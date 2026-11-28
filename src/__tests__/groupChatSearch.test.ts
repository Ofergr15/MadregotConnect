// Task 88: message search within one group chat — member-gated, pinned to that channel, paginated.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanCursor, cleanQuery, pageSize, toHits } from '@/lib/group-chat/search';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const search = vi.fn();
vi.mock('@/lib/stream/server', () => ({ CHANNEL_TYPE: 'messaging', getStreamServerClient: () => ({ search: (...a: unknown[]) => search(...a) }) }));
let members: string[] | null = ['me'];
vi.mock('@/lib/group-chat/server', async (o) => ({ ...(await o<object>()), groupChatMembers: async () => members }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
const { groupChannelId } = await import('@/lib/group-chat/server');
const { GET } = await import('@/app/api/group-chat/search/route');

const CID = `messaging:${groupChannelId('g1')}`;
const get = (qs: string) => GET(new Request(`http://x/api/group-chat/search?${qs}`));
const msg = (id: string, o: object = {}) => ({ message: { id, text: `t ${id}`, cid: CID, type: 'regular', created_at: '2026-11-20T10:00:00Z', user: { id: 'u', name: 'U' }, ...o } });
beforeEach(() => {
  search.mockReset(); members = ['me'];
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'me', isStaff: false, isSuperUser: false } });
});

describe('helpers', () => {
  it('cleanQuery: trims, strips bidi, enforces 2–100', () => {
    expect(cleanQuery('  \u200fריצה  ארוכה ')).toBe('ריצה ארוכה');
    expect(cleanQuery('a')).toBeNull();
    expect(cleanQuery('x'.repeat(101))).toBeNull();
    expect(cleanQuery(undefined)).toBeNull();
  });
  it('pageSize defaults to 20 and caps at 50', () => {
    expect([pageSize(null), pageSize('5'), pageSize('500'), pageSize('-1')]).toEqual([20, 5, 50, 20]);
  });
  it('cleanCursor drops junk', () => {
    expect(cleanCursor('abc123=')).toBe('abc123=');
    expect(cleanCursor('a b')).toBeNull();
  });
  it('toHits drops deleted, replies and other channels', () => {
    const hits = toHits([msg('1'), msg('2', { type: 'deleted' }), msg('3', { parent_id: '1' }), msg('4', { cid: 'messaging:other' })] as never, CID);
    expect(hits.map((h) => h.id)).toEqual(['1']);
    expect(hits[0]).toEqual({ id: '1', text: 't 1', authorId: 'u', authorName: 'U', at: '2026-11-20T10:00:00.000Z' });
  });
});

describe('GET /api/group-chat/search', () => {
  it('searches only this group channel and passes the cursor', async () => {
    search.mockResolvedValue({ results: [msg('1')], next: 'n2' });
    const body = await (await get('groupId=g1&q=long run&next=n1&limit=10')).json();
    expect(search).toHaveBeenCalledWith({ cid: CID }, 'long run', expect.objectContaining({ limit: 10, next: 'n1' }));
    expect(body).toEqual({ hits: [expect.objectContaining({ id: '1' })], next: 'n2' });
  });
  it('a non-member gets 403 and Stream is never asked', async () => {
    members = ['someone'];
    expect((await get('groupId=g1&q=hello')).status).toBe(403);
    expect(search).not.toHaveBeenCalled();
  });
  it('bad input → 400; unknown group → 404', async () => {
    expect((await get('q=hello')).status).toBe(400);
    expect((await get('groupId=g1&q=x')).status).toBe(400);
    members = null;
    expect((await get('groupId=nope&q=hello')).status).toBe(404);
  });
  it('no channel yet → empty; Stream down → 503', async () => {
    search.mockRejectedValueOnce(new Error('channel does not exist'));
    expect(await (await get('groupId=g1&q=hello')).json()).toEqual({ hits: [], next: null });
    search.mockRejectedValueOnce(new Error('timeout'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await get('groupId=g1&q=hello')).status).toBe(503);
  });
  it('unsigned → 401 from the gate', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response(null, { status: 401 }), caller: {} });
    expect((await get('groupId=g1&q=hello')).status).toBe(401);
  });
});
