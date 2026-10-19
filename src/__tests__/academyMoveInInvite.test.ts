import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * POST /api/academy/members/invite (somebody who already trains with us): the trainee gets
 * the move-in mail unless the manager asked for the link only, and the coaches hear now.
 */

const mail = vi.fn(async (_p: unknown) => ({ ok: true }));
const push = vi.fn(async (_p: unknown) => ({ subscriptions: 1, delivered: 1 }));
vi.mock('@/lib/email', () => ({ notifyAcademyMoveIn: (p: unknown) => mail(p) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: (p: unknown) => push(p) }));
vi.mock('@/lib/academy/pairing-server', () => ({
  requireAcademyManager: async () => ({ denied: null, caller: { athleteId: 'mgr' } }),
  setPairCoaches: async () => ({ ok: true }),
}));
vi.mock('@/lib/academy/coaches', () => ({ holdsAcademyCoachRole: () => true }));
const COACH = '11111111-1111-4111-8111-111111111111';
function athletesQuery() {
  let by = '';
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.limit = () => o;
  o.eq = (col: string) => { by = col; return o; };
  // Lookup by email: nobody has it yet. By id: the coach.
  o.maybeSingle = async () => (by === 'id' ? { data: { id: COACH, role: 'academy_coach' } } : { data: null });
  o.in = () => Promise.resolve({ data: [{ id: COACH, name: 'Shalev Bahalul' }], error: null });
  return o;
}
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (t: string) => ({
      select: () => (athletesQuery() as { select: () => unknown }).select(),
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'new-athlete' }, error: null }) }), then: (r: (v: unknown) => void) => r({ error: null }) }),
      _t: t,
    }),
  }),
}));

const { POST } = await import('@/app/api/academy/members/invite/route');
const post = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }));

beforeEach(() => { mail.mockClear(); push.mockClear(); });

describe('existing trainee invite', () => {
  it('mails the trainee and tells the coach, opening the trainee', async () => {
    const res = await post({ name: 'Yossi Levi', email: 'yossi@example.com', coachIds: [COACH] });
    const body = await res.json();
    expect(body.emailed).toBe(true);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ email: 'yossi@example.com', coachName: 'Shalev', token: expect.any(String) }));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ athleteId: COACH, kind: 'academy_trainee_assigned', url: expect.stringContaining('thread=new-athlete') }));
  });
  it('the link only, when asked', async () => {
    const body = await (await post({ name: 'Yossi Levi', email: 'yossi@example.com', coachIds: [COACH], sendEmail: false })).json();
    expect(body.emailed).toBe(false);
    expect(mail).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('the coach hears the trainee came in — at each door, once', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it('Strava on /join, only on the invited -> active flip', () => {
    expect(read('app/api/strava/callback/route.ts')).toMatch(/if \(invited\.status === 'invited' && invited\.approved !== false\) \{[\s\S]{0,200}notifyTraineeJoined\(admin as never, invited\.id\)/);
  });
  it('an email code, only when it flips invited -> active', () => {
    expect(read('app/api/auth/email-code/route.ts')).toMatch(/if \(member\.status === 'invited'\) \{[\s\S]{0,300}notifyTraineeJoined\(supabase, member\.id\)/);
  });
  it('confirming the details or Garmin on /join (/api/athletes/connect)', () => {
    expect(read('app/api/athletes/connect/route.ts')).toMatch(/if \(athlete\.status !== 'active'\) \{[\s\S]{0,300}if \(updateData\.status === 'active'\) \{[\s\S]{0,200}notifyTraineeJoined\(supabase, athlete\.id\)/);
  });
});
