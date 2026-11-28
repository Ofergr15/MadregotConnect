// Task 181: group chat edit/delete — 15-minute author window, staff delete at any age, an audit
// row before every change, member-gated, and never a push.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { CHAT_CHANGE_WINDOW_MS, changeRight, withinChangeWindow } from '@/lib/group-chat/change-guard';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));

const getMessage = vi.fn();
const updateMessage = vi.fn(async () => ({}));
const deleteMessage = vi.fn(async () => ({}));
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  getStreamServerClient: () => ({
    getMessage: (...a: unknown[]) => getMessage(...a),
    updateMessage: (...a: unknown[]) => updateMessage(...(a as [])),
    deleteMessage: (...a: unknown[]) => deleteMessage(...(a as [])),
  }),
}));
const notifyAthlete = vi.fn();
vi.mock('@/lib/push', () => ({ notifyAthlete: (...a: unknown[]) => notifyAthlete(...a) }));

let members: string[] | null = ['me', 'other', 'coach'];
vi.mock('@/lib/group-chat/server', async (o) => ({ ...(await o<object>()), groupChatMembers: async () => members }));

const audit: unknown[] = [];
let auditError: { code?: string; message: string } | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (t: string) => ({
      insert: async (row: unknown) => {
        if (t !== 'group_chat_message_audit') throw new Error(`unexpected table ${t}`);
        if (!auditError) audit.push(row);
        return { error: auditError };
      },
    }),
  }),
}));

const { groupChannelId } = await import('@/lib/group-chat/server');
const route = await import('@/app/api/group-chat/messages/route');
const as = (c: object) => resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'me', isStaff: false, isSuperUser: false, ...c } });
const CID = `messaging:${groupChannelId('g1')}`;
const msg = (ageMin: number, author = 'me') => ({
  message: { id: 'm1', cid: CID, text: 'old words', created_at: new Date(Date.now() - ageMin * 60_000).toISOString(), user: { id: author } },
});
const patch = (body: object = { groupId: 'g1', messageId: 'm1', text: 'new words' }) =>
  route.PATCH(new Request('http://x/api/group-chat/messages', { method: 'PATCH', body: JSON.stringify(body) }));
const del = () => route.DELETE(new Request('http://x/api/group-chat/messages?groupId=g1&messageId=m1', { method: 'DELETE' }));

beforeEach(() => {
  members = ['me', 'other', 'coach'];
  audit.length = 0;
  auditError = null;
  getMessage.mockReset().mockResolvedValue(msg(5));
  updateMessage.mockClear();
  deleteMessage.mockClear();
  notifyAthlete.mockClear();
  as({});
});

describe('change window rules', () => {
  const now = Date.parse('2026-11-28T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const runner = { athleteId: 'me', isStaff: false, isSuperUser: false };
  const coach = { athleteId: 'coach', isStaff: true, isSuperUser: false };
  it('15 minutes, inclusive; missing or junk timestamp = closed', () => {
    expect(withinChangeWindow(ago(CHAT_CHANGE_WINDOW_MS), now)).toBe(true);
    expect(withinChangeWindow(ago(CHAT_CHANGE_WINDOW_MS + 1), now)).toBe(false);
    expect(withinChangeWindow(null, now)).toBe(false);
    expect(withinChangeWindow('soon', now)).toBe(false);
  });
  it('author inside the window edits and deletes; outside, only "late"', () => {
    expect(changeRight(runner, 'edit', 'me', ago(60_000), now)).toEqual({ as: 'author', late: false });
    expect(changeRight(runner, 'delete', 'me', ago(60_000), now)).toEqual({ as: 'author', late: false });
    expect(changeRight(runner, 'edit', 'me', ago(20 * 60_000), now)).toEqual({ as: null, late: true });
    expect(changeRight(runner, 'delete', 'me', ago(20 * 60_000), now)).toEqual({ as: null, late: true });
  });
  it("staff delete anyone's message at any age, never edit it; a runner can't touch others'", () => {
    expect(changeRight(coach, 'delete', 'me', ago(9 * 86400_000), now)).toEqual({ as: 'staff', late: false });
    expect(changeRight(coach, 'edit', 'me', ago(60_000), now)).toEqual({ as: null, late: false });
    expect(changeRight(runner, 'delete', 'other', ago(60_000), now)).toEqual({ as: null, late: false });
  });
});

describe('PATCH /api/group-chat/messages', () => {
  it('fresh own message: audited (old + new text) then edited, nobody pushed', async () => {
    const res = await patch();
    expect(res.status).toBe(200);
    expect(audit).toEqual([{
      group_id: 'g1', message_id: 'm1', action: 'edit', actor_athlete_id: 'me', actor_as: 'author',
      author_athlete_id: 'me', old_text: 'old words', new_text: 'new words',
    }]);
    expect(updateMessage).toHaveBeenCalledTimes(1);
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
  it('after 15 minutes: 403 change_window_closed, no audit, no edit', async () => {
    getMessage.mockResolvedValue(msg(16));
    const res = await patch();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'change_window_closed', windowMinutes: 15 });
    expect(audit).toEqual([]);
    expect(updateMessage).not.toHaveBeenCalled();
  });
  it("someone else's message: 403, staff included", async () => {
    getMessage.mockResolvedValue(msg(1, 'other'));
    expect((await patch()).status).toBe(403);
    as({ athleteId: 'coach', isStaff: true });
    expect((await patch()).status).toBe(403);
    expect(updateMessage).not.toHaveBeenCalled();
  });
  it('non-member 403 before anything is read', async () => {
    members = ['other'];
    expect((await patch()).status).toBe(403);
    expect(getMessage).not.toHaveBeenCalled();
  });
  it('audit failure refuses the change; a missing table (346 unapplied) lets it through', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    auditError = { code: '23502', message: 'boom' };
    expect((await patch()).status).toBe(500);
    expect(updateMessage).not.toHaveBeenCalled();
    auditError = { code: '42P01', message: 'relation does not exist' };
    expect((await patch()).status).toBe(200);
    expect(updateMessage).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/group-chat/messages', () => {
  it('own fresh message: audited with the text the room saw, deleted, nobody pushed', async () => {
    expect((await del()).status).toBe(200);
    expect(audit).toEqual([expect.objectContaining({ action: 'delete', actor_as: 'author', old_text: 'old words', new_text: null })]);
    expect(deleteMessage).toHaveBeenCalledWith('m1');
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
  it('own old message: 403 window closed', async () => {
    getMessage.mockResolvedValue(msg(30));
    expect((await del()).status).toBe(403);
    expect(deleteMessage).not.toHaveBeenCalled();
  });
  it('staff remove a week-old message, audited as staff', async () => {
    as({ athleteId: 'coach', isStaff: true });
    getMessage.mockResolvedValue(msg(7 * 24 * 60, 'other'));
    expect((await del()).status).toBe(200);
    expect(audit).toEqual([expect.objectContaining({ actor_athlete_id: 'coach', actor_as: 'staff', author_athlete_id: 'other' })]);
  });
  it('a message from another chat is a 404', async () => {
    getMessage.mockResolvedValue({ message: { ...msg(1).message, cid: 'messaging:elsewhere' } });
    expect((await del()).status).toBe(404);
    expect(audit).toEqual([]);
  });
});

describe('migration 346', () => {
  it('is idempotent and service-role only', () => {
    const sql = readFileSync('supabase/migrations/346_group_chat_message_audit.sql', 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS group_chat_message_audit/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE group_chat_message_audit FROM anon, authenticated/);
  });
});
