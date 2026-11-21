// POST /api/auth/claim-member answers the SAME status and body whether or not the
// address belongs to a member, including when recording the claim or sending the
// mail fails. FIXTURE only: the DB is in memory and the mail is stubbed (nothing is sent).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';

let insertFails = false;
const db = createMemoryDb({
  schema: {
    athletes: ['id', 'name', 'email'],
    athlete_claims: ['id', 'token', 'shell_athlete_id', 'target_athlete_id', 'sent_to', 'created_at'],
  },
  defaults: { athlete_claims: () => ({ id: `c${Math.random()}`, created_at: new Date().toISOString() }) },
});
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (t: string) => {
      const b = db.client.from(t);
      if (t === 'athlete_claims' && insertFails) b.insert = () => Promise.resolve({ data: null, error: { code: '42P01', message: 'missing' } });
      return b;
    },
  }),
}));
vi.mock('@/lib/auth-session', async (o) => ({
  ...(await o<typeof import('@/lib/auth-session')>()),
  requireSession: async () => ({ ok: true, user: { athleteId: 'shell', email: 'strava_9001@strava.madregot.local', name: 'Dana' } }),
}));
let mailOk = true;
const mails: unknown[] = [];
vi.mock('@/lib/email', () => ({ notifyAthleteClaim: async (x: unknown) => { mails.push(x); return mailOk ? { ok: true } : { ok: false, reason: 'domain' }; } }));

const claim = async (email: string) => {
  const { POST } = await import('@/app/api/auth/claim-member/route');
  const r = await POST(new Request('http://x/api/auth/claim-member', { method: 'POST', body: JSON.stringify({ email }) }));
  return { status: r.status, body: await r.json() };
};

beforeEach(() => {
  for (const t of Object.values(db.tables)) t.length = 0;
  db.tables.athletes.push({ id: 'real', name: 'Dana Fixture', email: 'dana.fixture@example.test' });
  insertFails = false; mailOk = true; mails.length = 0;
});

describe('claim-member: no membership oracle', () => {
  it('member (mail sent) and stranger give the identical answer', async () => {
    const member = await claim('dana.fixture@example.test');
    const stranger = await claim('nobody@example.test');
    expect(member).toEqual({ status: 200, body: { ok: true } });
    expect(stranger).toEqual(member);
    expect(mails).toHaveLength(1);
  });
  it('member whose mail FAILS: still the identical answer (was 502 email-failed)', async () => {
    mailOk = false;
    expect(await claim('dana.fixture@example.test')).toEqual({ status: 200, body: { ok: true } });
  });
  it('member whose claim cannot be recorded: still the identical answer (was 503 claim-unavailable)', async () => {
    insertFails = true;
    expect(await claim('dana.fixture@example.test')).toEqual({ status: 200, body: { ok: true } });
    expect(mails).toHaveLength(0);
  });
  it('the mail goes to the ROSTER address, never to anything else typed', async () => {
    await claim('DANA.Fixture@example.test');
    expect(mails[0]).toMatchObject({ email: 'dana.fixture@example.test', athleteId: 'real' });
  });
});
