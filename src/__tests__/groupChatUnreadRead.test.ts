// Task 87: group chat unread per group per member in one Stream query; idempotent mark-read.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unreadByGroup } from '@/lib/group-chat/logic';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const queryChannels = vi.fn();
const markRead = vi.fn(async () => ({}));
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  getStreamServerClient: () => ({ queryChannels: (...a: unknown[]) => queryChannels(...a), channel: () => ({ markRead }) }),
}));
let members: string[] | null = ['me', 'x'];
let groups = [{ id: 'g1', name: 'A' }, { id: 'g2', name: 'B' }];
vi.mock('@/lib/group-chat/server', async (o) => ({
  ...(await o<object>()),
  groupChatMembers: async () => members,
  visibleChatGroups: async () => ({ error: null, groups }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
const { groupChannelId } = await import('@/lib/group-chat/server');
const unread = await import('@/app/api/group-chat/unread/route');
const read = await import('@/app/api/group-chat/read/route');

const as = (c: object) => resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'me', isStaff: false, isSuperUser: false, ...c } });
const postRead = (body: unknown) => read.POST(new Request('http://x/api/group-chat/read', { method: 'POST', body: JSON.stringify(body) }));
beforeEach(() => { groups = [{ id: 'g1', name: 'A' }, { id: 'g2', name: 'B' }]; queryChannels.mockReset(); markRead.mockClear(); members = ['me', 'x']; as({}); });

describe('unreadByGroup', () => {
  const map = new Map([['c1', 'g1'], ['c2', 'g2'], ['c3', 'g3']]);
  it("uses the server's per-user counter, falls back to countUnread, missing channel = 0", () => {
    const out = unreadByGroup([
      { id: 'c1', state: { read: { me: { unread_messages: 4 }, x: { unread_messages: 9 } } } },
      { id: 'c2', state: { read: {} }, countUnread: () => 2 },
    ], map, 'me');
    expect(out).toEqual({ byGroup: { g1: 4, g2: 2, g3: 0 }, total: 6 });
  });
  it('ignores channels outside the map and bad numbers', () => {
    const out = unreadByGroup([
      { id: 'other', state: { read: { me: { unread_messages: 50 } } } },
      { id: 'c1', state: { read: { me: { unread_messages: -3 } } } },
      { id: 'c2', state: {}, countUnread: () => { throw new Error('no state'); } },
    ], map, 'me');
    expect(out.total).toBe(0);
  });
});

describe('GET /api/group-chat/unread', () => {
  it('one Stream query, as the caller, no messages', async () => {
    queryChannels.mockResolvedValue([{ id: groupChannelId('g1'), state: { read: { me: { unread_messages: 3 } } } }]);
    const body = await (await unread.GET(new Request('http://x'))).json();
    expect(queryChannels).toHaveBeenCalledTimes(1);
    expect(queryChannels.mock.calls[0][2]).toMatchObject({ message_limit: 0, user_id: 'me' });
    expect(body).toMatchObject({ byGroup: { g1: 3, g2: 0 }, total: 3, streamError: null });
  });
  it('staff in 45 groups: pages of 30, every group counted', async () => {
    groups = Array.from({ length: 45 }, (_, i) => ({ id: `g${i}`, name: `G${i}` }));
    queryChannels.mockImplementation(async (f: { id: { $in: string[] } }) =>
      f.id.$in.map((id) => ({ id, state: { read: { me: { unread_messages: 1 } } } })));
    const body = await (await unread.GET(new Request('http://x'))).json();
    expect(queryChannels).toHaveBeenCalledTimes(2);
    expect(body.total).toBe(45);
  });
  it('Stream down → zeros + streamError, not 500', async () => {
    queryChannels.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await unread.GET(new Request('http://x'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total: 0, streamError: 'stream_unavailable' });
  });
  it('unsigned → the gate answers', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response(null, { status: 401 }), caller: {} });
    expect((await unread.GET(new Request('http://x'))).status).toBe(401);
  });
});

describe('POST /api/group-chat/read', () => {
  it('marks read as the caller; a repeat is the same 200', async () => {
    const a = await postRead({ groupId: 'g1' });
    const b = await postRead({ groupId: 'g1' });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await b.json()).toEqual({ ok: true, groupId: 'g1', unread: 0 });
    expect(markRead).toHaveBeenCalledWith({ user_id: 'me' });
  });
  it('no channel yet is still ok', async () => {
    markRead.mockRejectedValueOnce(new Error('channel not found'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await postRead({ groupId: 'g1' })).status).toBe(200);
  });
  it('non-member 403, unknown group 404, missing id 400', async () => {
    members = ['x'];
    expect((await postRead({ groupId: 'g1' })).status).toBe(403);
    members = null;
    expect((await postRead({ groupId: 'nope' })).status).toBe(404);
    expect((await postRead({})).status).toBe(400);
    expect(markRead).not.toHaveBeenCalled();
  });
  it("an admin viewing-as doesn't move the member's read point", async () => {
    as({ viewingAsBy: 'admin-1' });
    expect((await postRead({ groupId: 'g1' })).status).toBe(200);
    expect(markRead).not.toHaveBeenCalled();
  });
});
