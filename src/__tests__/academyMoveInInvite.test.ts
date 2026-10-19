import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Step 1 of the existing-trainee flow (POST /api/academy/members/invite): the details form
 * by email, the coaches preset on the row, and nobody else told yet. And step 6's one door:
 * the coach hears it when the app first opens for the trainee.
 */

const mail = vi.fn(async (_p: unknown) => ({ ok: true }));
vi.mock('@/lib/email', () => ({ notifyAcademyExistingForm: (p: unknown) => mail(p) }));
const pair = vi.fn(async (_id: string, _coaches: string[]) => ({ ok: true }));
vi.mock('@/lib/academy/pairing-server', () => ({
  requireAcademyManager: async () => ({ denied: null, caller: { athleteId: 'mgr' } }),
  setPairCoaches: (id: string, c: string[]) => pair(id, c),
}));
vi.mock('@/lib/academy/coaches', () => ({ holdsAcademyCoachRole: () => true }));
const COACH = '11111111-1111-4111-8111-111111111111';
const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
function athletesQuery() {
  let by = '';
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.eq = (col: string) => { by = col; return o; };
  o.maybeSingle = async () => (by === 'id' ? { data: { id: COACH, role: 'academy_coach' } } : { data: null });
  return o;
}
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      select: () => (athletesQuery() as { select: () => unknown }).select(),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: table === 'athletes' ? 'new-athlete' : 'card-1' }, error: null }) }) };
      },
    }),
  }),
}));

const { POST } = await import('@/app/api/academy/members/invite/route');
const post = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }));

beforeEach(() => { mail.mockClear(); pair.mockClear(); inserts.length = 0; });

describe('step 1 · name, email, coach', () => {
  it('mails the details form, presets the coach, and the row waits for the approval', async () => {
    const body = await (await post({ name: 'Yossi Levi', email: 'yossi@example.com', coachIds: [COACH] })).json();
    expect(body).toMatchObject({ emailed: true, candidateId: 'card-1', url: expect.stringMatching(/\/academy-register\?i=[0-9a-f]{32}$/) });
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ email: 'yossi@example.com', url: body.url, candidateId: 'card-1' }));
    expect(pair).toHaveBeenCalledWith('new-athlete', [COACH]);
    expect(inserts.find((i) => i.table === 'athletes')!.row).toMatchObject({ approved: false, onboarding_status: 'academy_pending', is_academy: true });
    expect(inserts.find((i) => i.table === 'academy_candidates')!.row).toMatchObject({ source: 'existing', athlete_id: 'new-athlete', invited_at: expect.any(String) });
  });
  it('the link only, when asked', async () => {
    const body = await (await post({ name: 'Yossi Levi', email: 'yossi@example.com', coachIds: [COACH], sendEmail: false })).json();
    expect(body.emailed).toBe(false);
    expect(mail).not.toHaveBeenCalled();
  });
});

describe('step 6 · the coach hears it when the app first opens for the trainee', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it('from /api/auth/me, only for the request that wins the first_seen_at stamp, only for the academy', () => {
    expect(read('app/api/auth/me/route.ts')).toMatch(/\.is\('first_seen_at', null\)\s*\.select\('id'\);[\s\S]{0,400}if \(won && won\.length > 0 && row\?\.is_academy\) \{[\s\S]{0,200}notifyTraineeJoined\(/);
  });
  it('and from nowhere else (saving details on /join is before the install)', () => {
    for (const p of ['app/api/strava/callback/route.ts', 'app/api/auth/email-code/route.ts', 'app/api/athletes/connect/route.ts']) {
      expect(read(p)).not.toMatch(/notifyTraineeJoined/);
    }
  });
});
