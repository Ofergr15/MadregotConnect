import { describe, it, expect, vi, beforeEach } from 'vitest';

// QA 11-17: the import board stores the requested band, but the invite dropped it, so an
// imported trainee (Roni: band 4) joined with no band. The invite must carry it.
const invite = vi.fn(async () => ({ status: 200, body: { emailed: true } }));
vi.mock('@/lib/academy/move-in-invite', () => ({ createMoveInInvite: invite }));

const card = {
  id: 'c1', name: 'QA Import', email: 'qa@example.com', phone: '', source: 'import', athlete_id: null, invited_at: null,
  intake: { _import: { marked: true, coachIds: ['coach-1'], requestedBand: 4, requestedBandId: 'band-4' }, imported: { height: 175 } },
};
const db = {
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'is', 'update']) chain[k] = () => chain;
    chain.maybeSingle = async () => ({ data: card, error: null });
    chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r);
    return chain;
  },
};

beforeEach(() => invite.mockClear());

describe('inviteImported carries the imported band', () => {
  it('passes requestedBandId as bandId to the move-in invite', async () => {
    const { inviteImported } = await import('@/lib/academy/sheet-import-server');
    const out = await inviteImported(db as never, { athleteId: 'mgr', email: 'm@x' } as never, ['c1']);
    expect(out[0]).toMatchObject({ ok: true });
    expect(invite).toHaveBeenCalledTimes(1);
    expect((invite.mock.calls[0] as unknown[])[1]).toMatchObject({ bandId: 'band-4', coachIds: ['coach-1'], cardId: 'c1' });
  });
  it('no requested band means bandId null, not a guess', async () => {
    (card.intake._import as Record<string, unknown>).requestedBandId = null;
    const { inviteImported } = await import('@/lib/academy/sheet-import-server');
    await inviteImported(db as never, { athleteId: 'mgr', email: 'm@x' } as never, ['c1']);
    expect((invite.mock.calls[0] as unknown[])[1]).toMatchObject({ bandId: null });
  });
});
