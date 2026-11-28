// Task 180: group chat read receipts + per-member unread, one Stream query, member-gated.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { buildReceipts } from '@/lib/group-chat/receipts';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));

const queryChannels = vi.fn();
const getMessage = vi.fn();
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  getStreamServerClient: () => ({
    queryChannels: (...a: unknown[]) => queryChannels(...a),
    getMessage: (...a: unknown[]) => getMessage(...a),
  }),
}));

let members: string[] | null = ['me', 'a', 'b'];
vi.mock('@/lib/group-chat/server', async (o) => ({ ...(await o<object>()), groupChatMembers: async () => members }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({ select: () => ({ in: async () => ({ data: [{ id: 'me', name: 'Me' }, { id: 'a', name: 'Avi' }, { id: 'b', name: 'Bat' }] }) }) }),
  }),
}));

const { groupChannelId } = await import('@/lib/group-chat/server');
const route = await import('@/app/api/group-chat/receipts/route');
const as = (c: object) => resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'me', isStaff: false, isSuperUser: false, ...c } });
const get = (q: string) => route.GET(new Request(`http://x/api/group-chat/receipts?${q}`));

const T = (m: number) => new Date(Date.UTC(2026, 10, 28, 10, m)).toISOString();
const READ = {
  me: { last_read: T(30), unread_messages: 0 },
  a: { last_read: T(20), unread_messages: 2 },
  b: { last_read: T(5), unread_messages: 7 },
  gone: { last_read: T(40), unread_messages: 0 },
};

beforeEach(() => {
  members = ['me', 'a', 'b'];
  queryChannels.mockReset().mockResolvedValue([{ id: groupChannelId('g1'), state: { read: READ } }]);
  getMessage.mockReset().mockResolvedValue({ message: { cid: `messaging:${groupChannelId('g1')}`, created_at: T(10), user: { id: 'me' } } });
  as({});
});

describe('buildReceipts', () => {
  const names = new Map([['me', 'Me'], ['a', 'Avi'], ['b', 'Bat']]);
  it('splits at the message time, leaves out the author and ex-members', () => {
    const r = buildReceipts({ read: READ, members: ['me', 'a', 'b'], names, messageAt: T(10), authorId: 'me', withUnread: false });
    expect(r.readBy.map((x) => x.athleteId)).toEqual(['a']);
    expect(r.notReadBy.map((x) => x.athleteId)).toEqual(['b']);
    expect(r.readBy[0].unread).toBeNull();
  });
  it('no message → everyone with a read point, newest first; unread only when asked', () => {
    const r = buildReceipts({ read: READ, members: ['me', 'a', 'b', 'never'], names, messageAt: null, withUnread: true });
    expect(r.readBy.map((x) => x.athleteId)).toEqual(['me', 'a', 'b']);
    expect(r.notReadBy).toEqual([{ athleteId: 'never', name: '', lastReadAt: null, unread: 0 }]);
    expect(r.readBy.find((x) => x.athleteId === 'b')?.unread).toBe(7);
  });
  it('a read point exactly at the message counts as read; junk is ignored', () => {
    const r = buildReceipts({
      read: { a: { last_read: T(10) }, b: { last_read: 'not a date', unread_messages: -4 } },
      members: ['a', 'b'], names, messageAt: T(10), withUnread: true,
    });
    expect(r.readBy.map((x) => x.athleteId)).toEqual(['a']);
    expect(r.notReadBy[0]).toMatchObject({ athleteId: 'b', lastReadAt: null, unread: 0 });
  });
});

describe('GET /api/group-chat/receipts', () => {
  it('member: seen-by for a message, no unread counts, one Stream query with no messages', async () => {
    const res = await get('groupId=g1&messageId=m1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.readBy).toEqual([{ athleteId: 'a', name: 'Avi', lastReadAt: T(20), unread: null }]);
    expect(body.notReadBy.map((x: { athleteId: string }) => x.athleteId)).toEqual(['b']);
    expect(queryChannels).toHaveBeenCalledTimes(1);
    expect(queryChannels.mock.calls[0][2]).toMatchObject({ message_limit: 0, watch: false, user_id: 'me' });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('staff get per-member unread', async () => {
    as({ isStaff: true });
    const body = await (await get('groupId=g1')).json();
    expect(Object.fromEntries(body.readBy.map((x: { athleteId: string; unread: number }) => [x.athleteId, x.unread]))).toEqual({ me: 0, a: 2, b: 7 });
  });
  it("a message from another group's chat is a 404", async () => {
    getMessage.mockResolvedValue({ message: { cid: 'messaging:other', created_at: T(1), user: { id: 'a' } } });
    expect((await get('groupId=g1&messageId=m1')).status).toBe(404);
    getMessage.mockRejectedValue(new Error('nope'));
    expect((await get('groupId=g1&messageId=m1')).status).toBe(404);
  });
  it('non-member 403, unknown group 404, missing id 400, unsigned answered by the gate', async () => {
    members = ['a'];
    expect((await get('groupId=g1')).status).toBe(403);
    members = null;
    expect((await get('groupId=g1')).status).toBe(404);
    expect((await get('')).status).toBe(400);
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response(null, { status: 401 }), caller: {} });
    expect((await get('groupId=g1')).status).toBe(401);
    expect(queryChannels).not.toHaveBeenCalled();
  });
  it('Stream down → 200 with everyone unread and streamError', async () => {
    queryChannels.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('groupId=g1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ readBy: [], streamError: 'stream_unavailable' });
    expect(body.notReadBy).toHaveLength(3);
  });
});

describe('migration 345', () => {
  it('indexes the two membership lookups, idempotently', () => {
    const sql = readFileSync('supabase/migrations/345_group_chat_member_indexes.sql', 'utf8');
    expect(sql).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS athletes_group_id_idx\s+ON athletes \(group_id\)/);
    expect(sql).toMatch(/IF NOT EXISTS athletes_staff_role_idx/);
  });
});
