import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  UNDO_WINDOW_MS, cleanNote, canUndo, decideReject, decideUndo, undoDeadline, withoutReasonColumns,
} from '@/lib/signup-decisions';

const NOW = new Date('2026-11-27T20:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('signup decisions — every state', () => {
  it('pending → reject with a reason', () => {
    const d = decideReject({ id: 'a', status: 'pending' }, { reason: 'spam' }, 'x@y', NOW);
    expect(d).toEqual({ ok: true, patch: expect.objectContaining({ status: 'rejected', decision_reason: 'spam', rejected_by: 'x@y' }) });
  });
  it('reject needs a known reason, and other needs a note', () => {
    expect(decideReject({ id: 'a', status: 'pending' }, { reason: 'meh' }, null, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(decideReject({ id: 'a', status: 'pending' }, { reason: 'other' }, null, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(decideReject({ id: 'a', status: 'pending' }, { reason: 'other', note: '  לא  מוכר ' }, null, NOW))
      .toMatchObject({ ok: true, patch: { decision_note: 'לא מוכר' } });
  });
  it.each(['approved', 'rejected', 'member'])('%s cannot be rejected', (status) => {
    expect(decideReject({ id: 'a', status }, { reason: 'spam' }, null, NOW)).toMatchObject({ ok: false, status: 409 });
  });
  it('rejected inside the window → undo to pending, clearing reason', () => {
    const row = { id: 'a', status: 'rejected', rejected_at: ago(UNDO_WINDOW_MS - 1000) };
    expect(canUndo(row, NOW)).toBe(true);
    expect(decideUndo(row, NOW)).toEqual({ ok: true, patch: expect.objectContaining({ status: 'pending', decision_reason: null, rejected_at: null }) });
  });
  it('rejected past the window, or with no timestamp, cannot be undone', () => {
    expect(decideUndo({ id: 'a', status: 'rejected', rejected_at: ago(UNDO_WINDOW_MS) }, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(decideUndo({ id: 'a', status: 'rejected', rejected_at: null }, NOW)).toMatchObject({ ok: false });
    expect(undoDeadline({ id: 'a', status: 'rejected', rejected_at: 'garbage' })).toBeNull();
  });
  it.each(['pending', 'approved', 'member'])('%s cannot be undone', (status) => {
    expect(decideUndo({ id: 'a', status, rejected_at: ago(1000) }, NOW)).toMatchObject({ ok: false, status: 409 });
  });
  it('note is capped and empty means null', () => {
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(5)).toBeNull();
    expect(cleanNote('א'.repeat(400))!.length).toBe(280);
  });
  it('pre-migration patch drops only the reason columns', () => {
    expect(withoutReasonColumns({ status: 'rejected', decision_reason: 'spam', decision_note: null })).toEqual({ status: 'rejected' });
  });
});

// ── Route ────────────────────────────────────────────────────────────────────
let row: Record<string, unknown> | null;
let updates: Array<Record<string, unknown>>;
let updateError: { code: string } | null;
let canApproveFlag = true;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from() {
      let patch: Record<string, unknown> | null = null;
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, gte: () => chain, order: () => chain,
        update: (p: Record<string, unknown>) => { patch = p; updates.push(p); return chain; },
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
        then: (res: (v: unknown) => unknown) => {
          if (patch) {
            const err = updateError;
            if (err && err.code === '42703' && 'decision_reason' in patch) return Promise.resolve({ data: null, error: err }).then(res);
            if (err && err.code !== '42703') return Promise.resolve({ data: null, error: err }).then(res);
            return Promise.resolve({ data: [{ id: 'r1' }], error: null }).then(res);
          }
          return Promise.resolve({ data: row ? [row] : [], error: null }).then(res);
        },
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true as const, user: { email: 'coach@x', canApprove: canApproveFlag } }),
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/admin/signup-queue/route');
  return POST(new Request('http://x/api/admin/signup-queue', { method: 'POST', body: JSON.stringify(body) }));
};

describe('POST /api/admin/signup-queue', () => {
  beforeEach(() => { updates = []; updateError = null; canApproveFlag = true; row = { id: 'r1', status: 'pending', rejected_at: null }; });

  it('403 without canApprove', async () => {
    canApproveFlag = false;
    expect((await post({ id: 'r1', action: 'reject', reason: 'spam' })).status).toBe(403);
  });
  it('400 on bad action / missing id; 404 on unknown row', async () => {
    expect((await post({ id: 'r1', action: 'approve' })).status).toBe(400);
    expect((await post({ action: 'reject' })).status).toBe(400);
    row = null;
    expect((await post({ id: 'r1', action: 'reject', reason: 'spam' })).status).toBe(404);
  });
  it('rejects with reason and returns undoUntil', async () => {
    const res = await post({ id: 'r1', action: 'reject', reason: 'duplicate' });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: 'rejected', reasonStored: true });
    expect(typeof json.undoUntil).toBe('string');
    expect(updates[0]).toMatchObject({ decision_reason: 'duplicate', rejected_by: 'coach@x' });
  });
  it('falls back when migration 240 is unapplied', async () => {
    updateError = { code: '42703' };
    const json = await (await post({ id: 'r1', action: 'reject', reason: 'spam' })).json();
    expect(json.reasonStored).toBe(false);
    expect(updates[1]).not.toHaveProperty('decision_reason');
  });
  it('undo inside the window; 409 when a newer pending request exists', async () => {
    row = { id: 'r1', status: 'rejected', rejected_at: new Date(Date.now() - 60_000).toISOString() };
    expect((await post({ id: 'r1', action: 'undo' })).status).toBe(200);
    updateError = { code: '23505' };
    expect((await post({ id: 'r1', action: 'undo' })).status).toBe(409);
  });
  it('approved rows are final', async () => {
    row = { id: 'r1', status: 'approved', rejected_at: null };
    expect((await post({ id: 'r1', action: 'undo' })).status).toBe(409);
  });
});
