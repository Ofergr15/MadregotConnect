// Night queue #65: plan-builder `me` lands in UUID columns. A staff caller with no athletes row used to fall
// back to their email → a 500 on the first write. Now: a 403 with code no_athlete before anything is written.
import { describe, it, expect, vi } from 'vitest';

let caller: any = { athleteId: null, email: 'coach@legacy.test' };
vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaffCaller: async () => ({ denied: null, caller }) }));
vi.mock('@/lib/academy/pairing-server', () => ({
  requireTraineeAccess: async () => ({ denied: null, caller, pair: { isAcademy: true } }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));

const { staff, gate } = await import('@/lib/plan-builder/route-helpers');

describe('plan-builder gate without an athlete row', () => {
  it('group week: 403 no_athlete, never the email as `me`', async () => {
    caller = { athleteId: null, email: 'coach@legacy.test' };
    const g = await gate(new Request('http://x/api/plan-builder/weeks/2026-11-22'));
    expect(g.denied?.status).toBe(403);
    expect(await g.denied!.json()).toMatchObject({ code: 'no_athlete' });
    expect(g.me).toBe('');
  });
  it('trainee week: same', async () => {
    const g = await gate(new Request('http://x/api/plan-builder/weeks/2026-11-22?athleteId=11111111-1111-4111-8111-111111111111'));
    expect(g.denied?.status).toBe(403);
  });
  it('with an athlete row: `me` is the athlete id', async () => {
    caller = { athleteId: '22222222-2222-4222-8222-222222222222', email: 'c@x.test' };
    const s = await staff(new Request('http://x'));
    expect(s.denied).toBeNull();
    expect(s.me).toBe('22222222-2222-4222-8222-222222222222');
  });
});
