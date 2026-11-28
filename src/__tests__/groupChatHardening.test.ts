import { beforeEach, describe, expect, it, vi } from 'vitest';

// Q28-2 / Q28-5: group chat membership is a diff (leavers removed), and the messages route
// refuses cross-channel quotes, deleted or foreign edits, and never leaks raw Stream errors.

const h = vi.hoisted(() => ({
  caller: { athleteId: 'a', isStaff: false, isSuperUser: false } as Record<string, unknown>,
  members: ['a', 'b'] as string[] | null,
  messages: new Map<string, Record<string, unknown>>(),
  stream: {} as Record<string, ReturnType<typeof vi.fn>>,
  channel: {} as Record<string, ReturnType<typeof vi.fn>>,
  current: [] as string[],
}));

vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller: h.caller }) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'in']) q[k] = () => q;
      q.maybeSingle = async () => ({ data: { name: 'x' } });
      q.then = (r: (v: unknown) => unknown) => r({ data: [{ id: 'g1', name: 'G' }], error: null });
      return q;
    },
  }),
}));
vi.mock('@/lib/packs/thread-server', () => ({ packThreadMembers: async () => h.members }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn(async () => undefined) }));
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  upsertStreamUsersFromAthletes: async () => undefined,
  getStreamServerClient: () => h.stream,
}));

import { ensureGroupChannel, groupChannelId, membersLeaving } from '@/lib/group-chat/server';
import { PATCH, POST } from '@/app/api/group-chat/messages/route';
import { GET } from '@/app/api/group-chat/route';

const CID = `messaging:${groupChannelId('g1')}`;
const req = (method: string, body: unknown) => new Request('http://x/api/group-chat/messages', { method, body: JSON.stringify(body) });

beforeEach(() => {
  h.caller = { athleteId: 'a', isStaff: false, isSuperUser: false };
  h.members = ['a', 'b'];
  h.current = [];
  h.messages = new Map([
    ['mine-0000', { id: 'mine-0000', cid: CID, user: { id: 'a' }, type: 'regular' }],
    ['theirs-000', { id: 'theirs-000', cid: CID, user: { id: 'b' }, type: 'regular' }],
    ['gone-00000', { id: 'gone-00000', cid: CID, user: { id: 'a' }, type: 'deleted', deleted_at: '2026-11-27' }],
    ['other-0000', { id: 'other-0000', cid: 'messaging:academy-a', user: { id: 'c' }, type: 'regular' }],
  ]);
  h.channel = {
    create: vi.fn(async () => ({})),
    addMembers: vi.fn(async () => ({})),
    removeMembers: vi.fn(async () => ({})),
    queryMembers: vi.fn(async () => ({ members: h.current.map((user_id) => ({ user_id })) })),
    sendMessage: vi.fn(async (m: { id?: string }) => ({ message: { id: m.id ?? 'new-id' } })),
  };
  h.stream = {
    channel: vi.fn(() => h.channel),
    getMessage: vi.fn(async (id: string) => ({ message: h.messages.get(id) })),
    partialUpdateMessage: vi.fn(async () => ({})),
    updateMessage: vi.fn(async () => ({})),
    queryChannels: vi.fn(async () => { throw new Error('Stream error: members a,b,c not allowed'); }),
  };
});

describe('group chat membership', () => {
  it('diffs the channel against who belongs', () => {
    expect(membersLeaving(['a', 'b', 'old', 'old', ''], ['a', 'b', 'new'])).toEqual(['old']);
    expect(membersLeaving(['a'], ['a'])).toEqual([]);
  });

  it('removes members who changed group, left the pack or were removed as coach', async () => {
    h.current = ['a', 'b', 'moved', 'removed-coach'];
    const r = await ensureGroupChannel(h.stream as never, {} as never, 'g1', ['a', 'b'], 'a');
    expect(h.channel.addMembers).toHaveBeenCalledWith(['a', 'b']);
    expect(h.channel.removeMembers).toHaveBeenCalledWith(['moved', 'removed-coach']);
    expect(r.removed).toEqual(['moved', 'removed-coach']);
  });

  it('removes nobody when the channel already matches', async () => {
    h.current = ['a', 'b'];
    await ensureGroupChannel(h.stream as never, {} as never, 'g1', ['a', 'b'], 'a');
    expect(h.channel.removeMembers).not.toHaveBeenCalled();
  });
});

describe('POST /api/group-chat/messages — quotes', () => {
  it('rejects a quote from another channel', async () => {
    const res = await POST(req('POST', { groupId: 'g1', text: 'hi', quotedMessageId: 'other-0000' }));
    expect(res.status).toBe(400);
    expect(h.channel.sendMessage).not.toHaveBeenCalled();
  });
  it('rejects a quote that does not exist', async () => {
    const res = await POST(req('POST', { groupId: 'g1', text: 'hi', quotedMessageId: 'missing-00' }));
    expect(res.status).toBe(400);
  });
  it('keeps a quote from this chat', async () => {
    const res = await POST(req('POST', { groupId: 'g1', text: 'hi', quotedMessageId: 'theirs-000' }));
    expect(res.status).toBe(200);
    expect(h.channel.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ quoted_message_id: 'theirs-000' }));
  });
});

describe('PATCH /api/group-chat/messages', () => {
  it('sets text only, so quotes and attachments survive', async () => {
    const res = await PATCH(req('PATCH', { groupId: 'g1', messageId: 'mine-0000', text: 'edited' }));
    expect(res.status).toBe(200);
    expect(h.stream.partialUpdateMessage).toHaveBeenCalledWith('mine-0000', { set: { text: 'edited' } }, 'a');
    expect(h.stream.updateMessage).not.toHaveBeenCalled();
  });
  it('refuses to edit a deleted message', async () => {
    const res = await PATCH(req('PATCH', { groupId: 'g1', messageId: 'gone-00000', text: 'back' }));
    expect(res.status).toBe(409);
    expect(h.stream.partialUpdateMessage).not.toHaveBeenCalled();
  });
  it("refuses to edit someone else's message, staff included", async () => {
    expect((await PATCH(req('PATCH', { groupId: 'g1', messageId: 'theirs-000', text: 'x' }))).status).toBe(403);
    h.caller = { athleteId: 'b2', isStaff: true, isSuperUser: false };
    h.members = ['a', 'b', 'b2'];
    expect((await PATCH(req('PATCH', { groupId: 'g1', messageId: 'mine-0000', text: 'x' }))).status).toBe(403);
    expect(h.stream.partialUpdateMessage).not.toHaveBeenCalled();
  });
  it('a message from another channel is a 404', async () => {
    expect((await PATCH(req('PATCH', { groupId: 'g1', messageId: 'other-0000', text: 'x' }))).status).toBe(404);
  });
});

describe('GET /api/group-chat', () => {
  it('returns a generic streamError, never the raw error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.caller = { athleteId: 'a', isStaff: true, isSuperUser: false };
    const res = await GET(new Request('http://x/api/group-chat'));
    const body = await res.json();
    expect(body.streamError).toBe('chat service unavailable');
    expect(JSON.stringify(body)).not.toMatch(/members a,b,c/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
