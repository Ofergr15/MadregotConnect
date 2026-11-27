import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { decideRate, takeSendSlot, resetRateStore, BURST_MAX, BURST_MS, HOUR_MAX, HOUR_MS } from '@/lib/group-chat/rate-limit';
import { cleanText, GROUP_CHAT_TEXT_MAX } from '@/lib/group-chat/logic';

/** Task 53: group chat moderation basics — rate limit, max length, report-a-message. */

const ME = uid();
const AUTHOR = uid();
const GROUP = uid();
const OTHER_GROUP = uid();

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const notifyStaff = vi.fn(async (_o: unknown) => ({ recipients: 1, sent: 1 }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: (o: unknown) => notifyStaff(o) }));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
let members: string[] | null = [ME, AUTHOR];
vi.mock('@/lib/group-chat/server', () => ({
  groupChannelId: (g: string) => `academy-pack-${g}`,
  groupChatMembers: async () => members,
}));
const messages: Record<string, { cid: string; user: { id: string } }> = {};
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  getStreamServerClient: () => ({
    getMessage: async (id: string) => { if (!messages[id]) throw new Error('not found'); return { message: messages[id] }; },
  }),
}));

const report = await import('@/app/api/group-chat/report/route');

const as = (athleteId: string | null) =>
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId, isStaff: false, isSuperUser: false, email: 'x@y', role: 'runner' } });
const post = (body: unknown) => report.POST(new Request('http://x/api/group-chat/report', { method: 'POST', body: JSON.stringify(body) }));

function seed(migrated = true) {
  db = createMemoryDb({
    schema: migrated
      ? { content_reports: ['id', 'reporter_athlete_id', 'target_type', 'target_id', 'author_athlete_id', 'author_verified', 'reason', 'note', 'status', 'created_at'] }
      : {},
  });
}

beforeEach(() => {
  seed(); as(ME); members = [ME, AUTHOR]; notifyStaff.mockClear();
  messages.m1 = { cid: `messaging:academy-pack-${GROUP}`, user: { id: AUTHOR } };
  messages.mine = { cid: `messaging:academy-pack-${GROUP}`, user: { id: ME } };
  messages.elsewhere = { cid: `messaging:academy-pack-${OTHER_GROUP}`, user: { id: AUTHOR } };
});

describe('rate limit', () => {
  it('allows a burst up to BURST_MAX, then answers with a retry', () => {
    const now = 1_000_000_000;
    const sent = Array.from({ length: BURST_MAX - 1 }, (_, i) => now - i * 1000);
    expect(decideRate(sent, now).ok).toBe(true);
    const d = decideRate([...sent, now - 500], now);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.retryAfterSec).toBeGreaterThan(0);
  });
  it('the burst window slides', () => {
    const now = 1_000_000_000;
    const old = Array.from({ length: BURST_MAX }, () => now - BURST_MS - 1);
    expect(decideRate(old, now).ok).toBe(true);
  });
  it('caps the hour', () => {
    const now = 1_000_000_000;
    const spread = Array.from({ length: HOUR_MAX }, (_, i) => now - BURST_MS - i * Math.floor((HOUR_MS - BURST_MS) / HOUR_MAX));
    expect(decideRate(spread, now).ok).toBe(false);
  });
  it('takeSendSlot is per member and records only allowed sends', () => {
    resetRateStore();
    const now = 5_000_000;
    for (let i = 0; i < BURST_MAX; i++) expect(takeSendSlot('a', now + i).ok).toBe(true);
    expect(takeSendSlot('a', now + BURST_MAX).ok).toBe(false);
    expect(takeSendSlot('b', now).ok).toBe(true);
  });
});

describe('max length', () => {
  it('rejects empty and over-long text', () => {
    expect(cleanText('  ')).toBeNull();
    expect(cleanText('x'.repeat(GROUP_CHAT_TEXT_MAX + 1))).toBeNull();
    expect(cleanText('x'.repeat(GROUP_CHAT_TEXT_MAX))).toHaveLength(GROUP_CHAT_TEXT_MAX);
  });
});

describe('POST /api/group-chat/report', () => {
  it('stores a verified report with the author read from Stream, reporter from the JWT', async () => {
    const res = await post({ groupId: GROUP, messageId: 'm1', reason: 'harassment', reporterAthleteId: AUTHOR, authorId: ME });
    expect(res.status).toBe(201);
    expect(db.tables.content_reports[0]).toMatchObject({
      reporter_athlete_id: ME, author_athlete_id: AUTHOR, author_verified: true, target_type: 'group_chat_message', target_id: 'm1',
    });
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['id']);
  });
  it('a repeat report returns the same id and does not push again', async () => {
    const a = await (await post({ groupId: GROUP, messageId: 'm1', reason: 'spam' })).json();
    const b = await (await post({ groupId: GROUP, messageId: 'm1', reason: 'spam' })).json();
    expect(b.id).toBe(a.id);
    expect(db.tables.content_reports).toHaveLength(1);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
  });
  it('a non-member cannot report into the room', async () => {
    members = [AUTHOR];
    expect((await post({ groupId: GROUP, messageId: 'm1', reason: 'spam' })).status).toBe(403);
  });
  it('a message from another group is a 404', async () => {
    expect((await post({ groupId: GROUP, messageId: 'elsewhere', reason: 'spam' })).status).toBe(404);
    expect((await post({ groupId: GROUP, messageId: 'nope', reason: 'spam' })).status).toBe(404);
  });
  it('own message and bad input are 400', async () => {
    expect((await post({ groupId: GROUP, messageId: 'mine', reason: 'spam' })).status).toBe(400);
    expect((await post({ groupId: GROUP, messageId: 'm1', reason: 'meh' })).status).toBe(400);
    expect((await post({ groupId: GROUP, messageId: 'm1', reason: 'spam', note: 'x'.repeat(501) })).status).toBe(400);
    expect((await post({ messageId: 'm1', reason: 'spam' })).status).toBe(400);
  });
  it('answers 503 before the moderation migration', async () => {
    seed(false);
    expect((await post({ groupId: GROUP, messageId: 'm1', reason: 'spam' })).status).toBe(503);
  });
  it('caps reports per hour', async () => {
    for (let i = 0; i < 10; i++) {
      messages[`x${i}`] = { cid: `messaging:academy-pack-${GROUP}`, user: { id: AUTHOR } };
      expect((await post({ groupId: GROUP, messageId: `x${i}`, reason: 'spam' })).status).toBe(201);
    }
    messages.x10 = { cid: `messaging:academy-pack-${GROUP}`, user: { id: AUTHOR } };
    expect((await post({ groupId: GROUP, messageId: 'x10', reason: 'spam' })).status).toBe(429);
  });
});
