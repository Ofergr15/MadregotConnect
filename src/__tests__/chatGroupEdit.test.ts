import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/** PATCH /api/chat/group — staff-only (JWT), group channels only, validated fields. */

const requireStaff = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireStaffCaller: async (r: Request) => ({ denied: await requireStaff(r), caller: { athleteId: 'staff-1' } }),
}));
const flagOn = vi.fn(async (_k: string, _id: string | null) => true);
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: (k: string, id: string | null) => flagOn(k, id) }));
const updatePartial = vi.fn();
const channel = vi.fn(() => ({ updatePartial }));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => ({ channel }) }));

const { PATCH } = await import('@/app/api/chat/group/route');
const { isGroupChannelId, parseGroupEdit } = await import('@/lib/stream/group-edit');

const call = (body: unknown) =>
  PATCH(new NextRequest('https://x.test/api/chat/group', {
    method: 'PATCH', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body),
  }));

beforeEach(() => {
  requireStaff.mockReset().mockResolvedValue(null);
  flagOn.mockReset().mockResolvedValue(true);
  updatePartial.mockReset().mockResolvedValue({});
  channel.mockClear();
});

describe('chat group edit', () => {
  it('refuses a non-staff caller before touching Stream', async () => {
    requireStaff.mockResolvedValue(new Response('{}', { status: 403 }));
    const res = await call({ channelId: 'academy-pack-1', name: 'X' });
    expect(res.status).toBe(403);
    expect(updatePartial).not.toHaveBeenCalled();
  });

  it('404 while native_chat_group_edit is off for the caller, before touching Stream', async () => {
    flagOn.mockResolvedValue(false);
    const res = await call({ channelId: 'academy-pack-1', name: 'X' });
    expect(res.status).toBe(404);
    expect(flagOn).toHaveBeenCalledWith('native_chat_group_edit', 'staff-1');
    expect(updatePartial).not.toHaveBeenCalled();
  });

  it('accepts only group prefixes', () => {
    expect(isGroupChannelId('academy-pack-abc')).toBe(true);
    expect(isGroupChannelId('run-123')).toBe(true);
    expect(isGroupChannelId('academy-athlete1')).toBe(false);
    expect(isGroupChannelId('!members-abc')).toBe(false);
    expect(isGroupChannelId('dm-a-b')).toBe(false);
    expect(isGroupChannelId('run-')).toBe(false);
    expect(isGroupChannelId(5)).toBe(false);
  });

  it('refuses a DM / 1:1 thread', async () => {
    const res = await call({ channelId: 'academy-runner-1', name: 'X' });
    expect(res.status).toBe(400);
    expect(updatePartial).not.toHaveBeenCalled();
  });

  it('trims and sets name, description, image', async () => {
    const res = await call({ channelId: 'academy-pack-1', name: '  Pack A ', description: ' d ', image: 'https://i/x.png' });
    expect(res.status).toBe(200);
    expect(channel).toHaveBeenCalledWith('messaging', 'academy-pack-1');
    expect(updatePartial).toHaveBeenCalledWith({ set: { name: 'Pack A', description: 'd', image: 'https://i/x.png' } });
  });

  it('validates fields', () => {
    expect(parseGroupEdit({ name: '   ' })).toEqual({ error: 'name required' });
    expect(parseGroupEdit({ name: 'x'.repeat(81) })).toEqual({ error: 'name too long' });
    expect(parseGroupEdit({ image: 'javascript:alert(1)' })).toEqual({ error: 'image must be an https URL' });
    expect(parseGroupEdit({})).toEqual({ error: 'nothing to update' });
    expect(parseGroupEdit({ description: '' })).toEqual({ patch: { description: '' } });
  });

  it('ignores identity fields in the body', async () => {
    await call({ channelId: 'run-1', name: 'N', email: 'boss@x', role: 'admin' });
    expect(updatePartial).toHaveBeenCalledWith({ set: { name: 'N' } });
  });
});
