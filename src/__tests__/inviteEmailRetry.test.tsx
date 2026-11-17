import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Ofer 11-17: an invite counted as done even when its mail failed. The failure must show on
// its card (from email_log, so it survives a reload), and "שליחה חוזרת" must resend the same
// mail with the same link to that one person, guarded against a double tap.

const formMail = vi.fn();
const moveInMail = vi.fn();
vi.mock('@/lib/email', () => ({ notifyAcademyExistingForm: formMail, notifyAcademyMoveIn: moveInMail }));
vi.mock('@/lib/academy/pairing-server', () => ({ setPairCoaches: async () => ({ ok: true }), requireAcademyManager: async () => ({ caller: { athleteId: 'mgr' } }) }));
vi.mock('@/lib/academy/coaches', () => ({ holdsAcademyCoachRole: () => true }));

type Op = { table: string; op: string; filters: Array<[string, string, unknown]>; payload?: unknown };
let ops: Op[] = [];
let handler: (o: Op) => { data: unknown; error: unknown } = () => ({ data: null, error: null });

function makeDb() {
  return {
    from(table: string) {
      const o: Op = { table, op: 'select', filters: [] };
      const chain: Record<string, unknown> = {};
      for (const k of ['select', 'order', 'limit', 'single', 'maybeSingle']) chain[k] = () => chain;
      for (const k of ['eq', 'in', 'is']) chain[k] = (c: string, v: unknown) => { o.filters.push([k, c, v]); return chain; };
      for (const k of ['insert', 'update', 'upsert', 'delete']) chain[k] = (p: unknown) => { o.op = k; o.payload = p; return chain; };
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => { ops.push(o); return Promise.resolve(handler(o)).then(res, rej); };
      return chain;
    },
  };
}
const db = makeDb();
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

const caller = { athleteId: 'mgr', email: 'm@x' } as never;
const filter = (o: Op, col: string) => o.filters.find((f) => f[1] === col)?.[2];

beforeEach(() => {
  ops = [];
  formMail.mockReset();
  moveInMail.mockReset();
  handler = () => ({ data: null, error: null });
});

describe('a failed send is reported as failed', () => {
  it('createMoveInInvite: refused mail → 200 with emailed:false and the provider reason', async () => {
    formMail.mockResolvedValue({ ok: false, status: 'refused', code: 'validation_error', reason: 'Invalid `to` field', logId: 'l1' });
    handler = (o) => {
      if (o.table === 'athletes' && o.op === 'select') return { data: null, error: null };
      if (o.table === 'athletes' && o.op === 'insert') return { data: { id: 'a1' }, error: null };
      if (o.table === 'academy_candidates') return { data: { id: 'c1' }, error: null };
      return { data: null, error: null };
    };
    const { createMoveInInvite } = await import('@/lib/academy/move-in-invite');
    const r = await createMoveInInvite(caller, { name: 'Dana', email: 'dana@example.com', coachIds: [] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ emailed: false, emailError: 'Invalid `to` field', candidateId: 'c1' });
  });

  it('createMoveInInvite: a thrown send is emailed:false too', async () => {
    formMail.mockRejectedValue(new Error('network'));
    handler = (o) => (o.table === 'athletes' && o.op === 'insert' ? { data: { id: 'a1' }, error: null } : o.table === 'academy_candidates' ? { data: { id: 'c1' }, error: null } : { data: null, error: null });
    const { createMoveInInvite } = await import('@/lib/academy/move-in-invite');
    const r = await createMoveInInvite(caller, { name: 'Dana', email: 'dana@example.com', coachIds: [] });
    expect(r.body).toMatchObject({ emailed: false, emailError: 'send_failed' });
  });

  it('the board marks the card failed from email_log (latest form send), with the error', async () => {
    const cards = [
      { id: 'c1', name: 'Fail', email: 'f@x.com', source: 'existing', athlete_id: null, invited_at: '2026-11-17T10:00:00Z', accepted_at: null, archived_at: null, intake: { _import: {} } },
      { id: 'c2', name: 'Ok', email: 'o@x.com', source: 'existing', athlete_id: null, invited_at: '2026-11-17T10:00:00Z', accepted_at: null, archived_at: null, intake: { _import: {} } },
    ];
    handler = (o) => {
      if (o.table === 'academy_candidates') return { data: cards, error: null };
      if (o.table === 'email_log') return { data: [
        { candidate_id: 'c1', template: 'academy_existing_form', status: 'refused', error_code: 'validation_error', error_message: 'Invalid `to` field', created_at: '2026-11-17T10:00:01Z' },
        { candidate_id: 'c2', template: 'academy_existing_form', status: 'sent', error_code: null, error_message: null, created_at: '2026-11-17T10:00:02Z' },
        { candidate_id: 'c2', template: 'academy_existing_form', status: 'failed', error_code: 'exception', error_message: 'old', created_at: '2026-11-17T09:00:00Z' },
      ], error: null };
      return { data: [], error: null };
    };
    const { loadImportBoard } = await import('@/lib/academy/sheet-import-server');
    const rows = await loadImportBoard(db as never, Date.parse('2026-11-17T12:00:00Z'));
    const by = Object.fromEntries(rows.map((r) => [r.cardId, r]));
    expect(by.c1.mail).toMatchObject({ kind: 'form', failed: true, status: 'refused', error: 'Invalid `to` field' });
    expect(by.c2.mail).toMatchObject({ kind: 'form', failed: false, status: 'sent' });
  });

  it('the failed card renders the red "המייל לא נשלח" state with the reason and a resend button', async () => {
    const { InviteMailFailed } = await import('@/components/academy/InviteMailFailed');
    const html = renderToStaticMarkup(<InviteMailFailed cardId="c1" kind="form" error="Invalid `to` field" />);
    expect(html).toContain('המייל לא נשלח');
    expect(html).toContain('Invalid `to` field');
    expect(html).toContain('שליחה חוזרת');
    expect(html).toContain('<bdi dir="ltr">');
  });
});

describe('resendInviteMail', () => {
  const NOW = Date.parse('2026-11-17T12:00:00Z');
  const baseCard = { id: 'c1', name: 'Dana', email: 'dana@example.com', athlete_id: 'a1', invite_token: 'formtok', accepted_at: null as string | null, archived_at: null };
  const setup = (card: typeof baseCard, log: Array<{ status: string; created_at: string }> = []) => {
    handler = (o) => {
      if (o.table === 'academy_candidates' && o.op === 'select') return { data: card, error: null };
      if (o.table === 'athletes' && o.op === 'select') return { data: { id: 'a1', email: 'dana@example.com', name: 'Dana', invite_token: 'jointok' }, error: null };
      if (o.table === 'email_log') return { data: log, error: null };
      return { data: null, error: null };
    };
  };
  const writes = () => ops.filter((o) => o.op !== 'select');

  it('form: same template, same url (the card token), once, for that card only — nothing written', async () => {
    setup({ ...baseCard });
    formMail.mockResolvedValue({ ok: true, status: 'sent', providerId: 'p', logId: 'l' });
    const { resendInviteMail } = await import('@/lib/academy/invite-email');
    const { inviteUrl } = await import('@/lib/academy/intake');
    const r = await resendInviteMail(db as never, caller, 'c1', 'form', NOW);
    expect(r).toMatchObject({ status: 200, body: { emailed: true, alreadySent: false } });
    expect(formMail).toHaveBeenCalledTimes(1);
    expect(formMail.mock.calls[0][0]).toEqual({ email: 'dana@example.com', name: 'Dana', url: inviteUrl('formtok'), candidateId: 'c1', athleteId: 'a1' });
    expect(formMail.mock.calls[0][0]).not.toHaveProperty('reminder');
    expect(moveInMail).not.toHaveBeenCalled();
    expect(writes()).toEqual([]); // no athlete row, no card, no token rotation
    expect(ops.filter((o) => o.table === 'academy_candidates').every((o) => filter(o, 'id') === 'c1')).toBe(true);
  });

  it('install: the athlete\'s existing join token, once, after acceptance', async () => {
    setup({ ...baseCard, accepted_at: '2026-11-17T11:00:00Z' });
    moveInMail.mockResolvedValue({ ok: true, status: 'sent', providerId: 'p', logId: 'l' });
    const { resendInviteMail } = await import('@/lib/academy/invite-email');
    const r = await resendInviteMail(db as never, caller, 'c1', 'install', NOW);
    expect(r.body).toMatchObject({ emailed: true });
    expect(moveInMail).toHaveBeenCalledTimes(1);
    expect(moveInMail.mock.calls[0][0]).toEqual({ email: 'dana@example.com', name: 'Dana', token: 'jointok', athleteId: 'a1', candidateId: 'c1' });
    expect(formMail).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('a double tap (same mail sent < 60s ago) is refused with 429 and sends nothing', async () => {
    setup({ ...baseCard }, [{ status: 'sent', created_at: new Date(NOW - 20_000).toISOString() }]);
    const { resendInviteMail } = await import('@/lib/academy/invite-email');
    const r = await resendInviteMail(db as never, caller, 'c1', 'form', NOW);
    expect(r.status).toBe(429);
    expect(formMail).not.toHaveBeenCalled();
  });

  it('a recent FAILED send does not block the retry', async () => {
    setup({ ...baseCard }, [{ status: 'refused', created_at: new Date(NOW - 5_000).toISOString() }]);
    formMail.mockResolvedValue({ ok: true, status: 'sent', providerId: 'p', logId: 'l' });
    const { resendInviteMail } = await import('@/lib/academy/invite-email');
    const r = await resendInviteMail(db as never, caller, 'c1', 'form', NOW);
    expect(r.status).toBe(200);
    expect(formMail).toHaveBeenCalledTimes(1);
  });

  it('a card whose mail already succeeded (> 60s ago) may be resent, and it is logged', async () => {
    setup({ ...baseCard }, [{ status: 'delivered', created_at: new Date(NOW - 3_600_000).toISOString() }]);
    formMail.mockResolvedValue({ ok: true, status: 'sent', providerId: 'p', logId: 'l' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { resendInviteMail } = await import('@/lib/academy/invite-email');
    const r = await resendInviteMail(db as never, caller, 'c1', 'form', NOW);
    expect(r.body).toMatchObject({ emailed: true, alreadySent: true });
    expect(formMail).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('already went out'));
    info.mockRestore();
  });

  it('a resend that fails again reports emailed:false with the reason', async () => {
    setup({ ...baseCard });
    formMail.mockResolvedValue({ ok: false, status: 'refused', code: 'x', reason: 'bad address', logId: 'l' });
    const { resendInviteMail } = await import('@/lib/academy/invite-email');
    const r = await resendInviteMail(db as never, caller, 'c1', 'form', NOW);
    expect(r.body).toMatchObject({ emailed: false, error: 'bad address' });
  });

  it('wrong phase is refused: form after acceptance, install before it', async () => {
    const { resendInviteMail } = await import('@/lib/academy/invite-email');
    setup({ ...baseCard, accepted_at: '2026-11-17T11:00:00Z' });
    expect((await resendInviteMail(db as never, caller, 'c1', 'form', NOW)).status).toBe(409);
    setup({ ...baseCard });
    expect((await resendInviteMail(db as never, caller, 'c1', 'install', NOW)).status).toBe(409);
    expect(formMail).not.toHaveBeenCalled();
    expect(moveInMail).not.toHaveBeenCalled();
  });
});

describe('the resend route', () => {
  it('rejects a bad body before touching anything', async () => {
    const { POST } = await import('@/app/api/academy/members/invite/resend/route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ cardId: 'nope', kind: 'form' }) }));
    expect(res.status).toBe(400);
    expect(ops).toEqual([]);
  });
});
