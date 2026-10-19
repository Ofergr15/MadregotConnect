import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The academy's two reminders on the way in: the details form, and the install. Once each, 2–14 days on. */

const formMail = vi.fn(async (_p: unknown) => ({ ok: true }));
const moveInMail = vi.fn(async (_p: unknown) => ({ ok: true }));
const acceptedMail = vi.fn(async (_p: unknown) => ({ ok: true }));
vi.mock('@/lib/email', () => ({
  notifyAcademyExistingForm: (p: unknown) => formMail(p),
  notifyAcademyMoveIn: (p: unknown) => moveInMail(p),
  notifyAcademyAccepted: (p: unknown) => acceptedMail(p),
}));

const TOK = 'a'.repeat(32);
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
function query(rows: Row[]) {
  let out = rows;
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (k: string, v: unknown) => { out = out.filter((r) => r[k] === v); return q; };
  q.is = (k: string, v: unknown) => { out = out.filter((r) => (r[k] ?? null) === v); return q; };
  q.not = (k: string) => { out = out.filter((r) => r[k] != null); return q; };
  q.gte = (k: string, v: string) => { out = out.filter((r) => typeof r[k] === 'string' && (r[k] as string) >= v); return q; };
  q.lte = (k: string, v: string) => { out = out.filter((r) => typeof r[k] === 'string' && (r[k] as string) <= v); return q; };
  q.in = (k: string, v: unknown[]) => { out = out.filter((r) => v.includes(r[k])); return q; };
  q.then = (res: (v: unknown) => void) => res({ data: out, error: null });
  return q;
}
const db = { from: (t: string) => query(tables[t] || []) } as never;
const fired = new Set<string>();
const ledger = { already: async (t: string) => fired.has(t), markFired: async (t: string) => { fired.add(t); } };

const { runAcademyOnboardingReminders } = await import('@/lib/academy/onboarding-reminders');
const now = new Date('2026-10-22T07:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

beforeEach(() => {
  formMail.mockClear(); moveInMail.mockClear(); acceptedMail.mockClear(); fired.clear();
  tables.academy_candidates = [
    { id: 'c-form', name: 'Yossi', email: 'y@x.co', source: 'existing', invite_token: TOK, invited_at: daysAgo(3), intake: null, archived_at: null, accepted_at: null, athlete_id: 'y' },
    { id: 'c-filled', name: 'Noa', email: 'n@x.co', source: 'existing', invite_token: TOK, invited_at: daysAgo(3), intake: { a: 1 }, archived_at: null, accepted_at: null, athlete_id: 'n' },
    { id: 'c-fresh', name: 'Avi', email: 'a@x.co', source: 'existing', invite_token: TOK, invited_at: daysAgo(1), intake: null, archived_at: null, accepted_at: null, athlete_id: 'av' },
    { id: 'c-ex', name: 'Gal', email: 'g@x.co', source: 'existing', athlete_id: 'g', accepted_at: daysAgo(4), archived_at: null, invited_at: daysAgo(9), intake: { a: 1 } },
    { id: 'c-new', name: 'Dana', email: 'd@x.co', source: 'form', athlete_id: 'd', accepted_at: daysAgo(5), archived_at: null },
    { id: 'c-in', name: 'Tal', email: 't@x.co', source: 'existing', athlete_id: 't', accepted_at: daysAgo(5), archived_at: null },
  ];
  tables.athletes = [
    { id: 'g', name: 'Gal', email: 'g@x.co', invite_token: TOK, first_seen_at: null, is_academy: true },
    { id: 'd', name: 'Dana', email: 'd@x.co', invite_token: TOK, first_seen_at: null, is_academy: true },
    { id: 't', name: 'Tal', email: 't@x.co', invite_token: TOK, first_seen_at: daysAgo(4), is_academy: true },
  ];
});

describe('academy onboarding reminders', () => {
  it('the form to who has not filled it after 48h; the install to who never opened the app', async () => {
    expect(await runAcademyOnboardingReminders(db, now, ledger)).toEqual({ form: 1, install: 2 });
    expect(formMail).toHaveBeenCalledWith(expect.objectContaining({ candidateId: 'c-form', reminder: true, url: expect.stringContaining(`i=${TOK}`) }));
    expect(moveInMail).toHaveBeenCalledWith(expect.objectContaining({ athleteId: 'g', reminder: true }));
    expect(acceptedMail).toHaveBeenCalledWith(expect.objectContaining({ athleteId: 'd', reminder: true }));
  });
  it('once per person', async () => {
    await runAcademyOnboardingReminders(db, now, ledger);
    expect(await runAcademyOnboardingReminders(db, now, ledger)).toEqual({ form: 0, install: 0 });
  });
});
