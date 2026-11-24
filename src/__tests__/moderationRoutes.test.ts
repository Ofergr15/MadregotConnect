import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * /api/moderation/report and /api/moderation/block (migration 203).
 *
 * Identity is the JWT's, never the body's; the author is never notified; an
 * unapplied migration answers 503 so the native client falls back to /api/feedback.
 */

const ME = uid();
const AUTHOR = uid();
const SOMEONE = uid();

const resolveVerifiedCaller = vi.fn();
const requireStaffCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r),
  requireStaffCaller: (r: Request) => requireStaffCaller(r),
}));
const notifyStaff = vi.fn(async (_o: unknown) => ({ recipients: 1, sent: 1 }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: (o: unknown) => notifyStaff(o) }));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const report = await import('@/app/api/moderation/report/route');
const block = await import('@/app/api/moderation/block/route');
const { validateReport, blockedAuthorIds } = await import('@/lib/moderation/blocks');

const as = (athleteId: string | null, isStaff = false) => {
  const caller = { athleteId, isStaff, isSuperUser: false, email: 'x@y', role: isStaff ? 'coach' : 'runner' };
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller });
  requireStaffCaller.mockResolvedValue(
    isStaff ? { denied: null, caller } : { denied: new Response('{}', { status: 403 }), caller },
  );
};
const req = (method: string, body?: unknown, q = '') =>
  new Request(`http://x/api/moderation${q}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });

function seed(migrated = true) {
  db = createMemoryDb({
    schema: {
      ...(migrated
        ? {
            content_reports: ['id', 'reporter_athlete_id', 'target_type', 'target_id', 'author_athlete_id', 'reason', 'note', 'status', 'created_at', 'handled_at', 'handled_by'],
            athlete_blocks: ['blocker_athlete_id', 'blocked_athlete_id', 'created_at'],
          }
        : {}),
      feed_items: ['id', 'author_athlete_id'],
      feed_comments: ['id', 'athlete_id'],
    },
  });
}

beforeEach(() => { seed(); as(ME); notifyStaff.mockClear(); });

describe('validateReport', () => {
  it('accepts the contract shape and rejects anything off it', () => {
    expect(validateReport({ targetType: 'comment', targetId: 'c1', reason: 'spam' }).ok).toBe(true);
    expect(validateReport({ targetType: 'dm', targetId: 'c1', reason: 'spam' }).ok).toBe(false);
    expect(validateReport({ targetType: 'comment', targetId: '', reason: 'spam' }).ok).toBe(false);
    expect(validateReport({ targetType: 'comment', targetId: 'c1', reason: 'meh' }).ok).toBe(false);
    expect(validateReport({ targetType: 'comment', targetId: 'c1', reason: 'spam', authorId: 'not-a-uuid' }).ok).toBe(false);
    expect(validateReport({ targetType: 'comment', targetId: 'c1', reason: 'spam', note: 'x'.repeat(501) }).ok).toBe(false);
    expect(validateReport({ targetType: 'comment', targetId: 'c1', reason: 'spam', note: 'x'.repeat(500) }).ok).toBe(true);
  });
});

describe('POST /api/moderation/report', () => {
  it('stores the reporter from the JWT, not the body, and returns { id }', async () => {
    const res = await report.POST(req('POST', { targetType: 'run_chat_message', targetId: 'stream-msg-1', authorId: AUTHOR, reason: 'harassment', reporterAthleteId: SOMEONE }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(id).toBeTruthy();
    const row = db.tables.content_reports[0];
    expect(row).toMatchObject({ reporter_athlete_id: ME, author_athlete_id: AUTHOR, target_type: 'run_chat_message', reason: 'harassment' });
  });

  it('reads a feed item author from the row, ignoring the body hint', async () => {
    const item = uid();
    db.tables.feed_items.push({ id: item, author_athlete_id: AUTHOR });
    await report.POST(req('POST', { targetType: 'feed_item', targetId: item, authorId: SOMEONE, reason: 'offensive' }));
    expect(db.tables.content_reports[0].author_athlete_id).toBe(AUTHOR);
  });

  it('notifies staff only, through the content_report kind, naming nobody', async () => {
    await report.POST(req('POST', { targetType: 'comment', targetId: 'c1', authorId: AUTHOR, reason: 'spam' }));
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    const opts = (notifyStaff.mock.calls[0] as unknown[])[0] as { kind: string; copy: (l: string) => { body: string } };
    expect(opts.kind).toBe('content_report');
    expect(opts.copy('en').body).not.toContain(ME);
    expect(opts.copy('he').body).not.toContain(AUTHOR);
  });

  it('400 on a bad body, 503 when 203 is unapplied', async () => {
    expect((await report.POST(req('POST', { targetType: 'x' }))).status).toBe(400);
    seed(false);
    expect((await report.POST(req('POST', { targetType: 'comment', targetId: 'c1', reason: 'spam' }))).status).toBe(503);
  });

  it('staff list and resolve; a runner gets 403', async () => {
    await report.POST(req('POST', { targetType: 'comment', targetId: 'c1', reason: 'spam' }));
    expect((await report.GET(req('GET'))).status).toBe(403);
    as(SOMEONE, true);
    const list = await (await report.GET(req('GET'))).json();
    expect(list.reports).toHaveLength(1);
    const res = await report.PATCH(req('PATCH', { id: list.reports[0].id, status: 'actioned' }));
    expect(res.status).toBe(200);
    expect(db.tables.content_reports[0]).toMatchObject({ status: 'actioned', handled_by: SOMEONE });
  });
});

describe('/api/moderation/block', () => {
  it('blocks, lists and unblocks for the caller only, idempotently', async () => {
    expect((await block.POST(req('POST', { athleteId: AUTHOR }))).status).toBe(200);
    expect((await block.POST(req('POST', { athleteId: AUTHOR }))).status).toBe(200);
    expect(await (await block.GET(req('GET'))).json()).toEqual({ blocked: [AUTHOR] });
    as(SOMEONE);
    expect(await (await block.GET(req('GET'))).json()).toEqual({ blocked: [] });
    as(ME);
    expect((await block.DELETE(req('DELETE', { athleteId: AUTHOR }))).status).toBe(200);
    expect(await (await block.GET(req('GET'))).json()).toEqual({ blocked: [] });
  });

  it('rejects a bad id and blocking yourself', async () => {
    expect((await block.POST(req('POST', { athleteId: 'nope' }))).status).toBe(400);
    expect((await block.POST(req('POST', { athleteId: ME }))).status).toBe(400);
  });

  it('403 for a caller with no athlete row; 503 unmigrated', async () => {
    as(null, true);
    expect((await block.GET(req('GET'))).status).toBe(403);
    as(ME);
    seed(false);
    expect((await block.GET(req('GET'))).status).toBe(503);
    expect((await block.POST(req('POST', { athleteId: AUTHOR }))).status).toBe(503);
  });
});

describe('blockedAuthorIds', () => {
  it('fails open when the table is missing or there is no viewer', async () => {
    seed(false);
    expect((await blockedAuthorIds(db.client, ME)).size).toBe(0);
    expect((await blockedAuthorIds(db.client, null)).size).toBe(0);
  });
});
