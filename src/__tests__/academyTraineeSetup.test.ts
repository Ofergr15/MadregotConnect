import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COACHING_TYPES, isCoachingType, setupMissing } from '@/lib/academy/trainee-setup';

/**
 * The coach's "טופס התאמה" (academy-onboarding/who-fills-what.html): coaching type and band
 * are the coach's calls; the trainee can neither read nor write them through this route.
 */
describe('what the coach still has to fill in', () => {
  it('lists coaching type, band, goal and days, in that order, until set', () => {
    expect(setupMissing({ coachingType: null, bandId: null, goalType: null, availableDays: [] })).toEqual(['coachingType', 'band', 'goal', 'days']);
    expect(setupMissing({ coachingType: COACHING_TYPES[0], bandId: 'b', goalType: 'full', availableDays: [0, 2] })).toEqual([]);
  });
  it('takes only the two coaching types the academy sells', () => {
    expect(isCoachingType(COACHING_TYPES[1])).toBe(true);
    expect(isCoachingType('משהו אחר')).toBe(false);
  });
});

const caller = vi.fn();
const coaches = vi.fn(async () => true);
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: () => caller() }));
vi.mock('@/lib/academy/pairing-server', () => ({ mayCoach: () => coaches() }));
const updates: Array<Record<string, unknown>> = [];
function q(result: unknown) {
  const o: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'order', 'limit']) o[k] = () => o;
  o.maybeSingle = async () => result;
  o.update = (p: Record<string, unknown>) => { updates.push(p); return { eq: () => ({ eq: async () => ({ error: null }) }) }; };
  return o;
}
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (t: string) => (t === 'academy_bands'
      ? q({ data: { id: 'b5', active: true } })
      : q({ data: { academy_intake: { medicalHistory: 'בריא' } } })),
  }),
}));

const { PUT } = await import('@/app/api/academy/trainee-setup/route');
const put = (b: unknown) => PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(b) }));

beforeEach(() => { caller.mockReset(); coaches.mockReset(); coaches.mockResolvedValue(true); updates.length = 0; });

describe('PUT /api/academy/trainee-setup', () => {
  it('refuses the trainee themselves', async () => {
    caller.mockResolvedValue({ denied: null, caller: { athleteId: 'yossi' } });
    expect((await put({ athleteId: 'yossi', coachingType: COACHING_TYPES[0] })).status).toBe(403);
    expect(updates).toHaveLength(0);
  });
  it('refuses somebody who is not their coach', async () => {
    caller.mockResolvedValue({ denied: null, caller: { athleteId: 'other' } });
    coaches.mockResolvedValue(false);
    expect((await put({ athleteId: 'yossi', bandId: 'b5' })).status).toBe(403);
  });
  it('their coach sets the coaching type (into the form answers, keeping the rest) and the band', async () => {
    caller.mockResolvedValue({ denied: null, caller: { athleteId: 'coach' } });
    expect((await put({ athleteId: 'yossi', coachingType: COACHING_TYPES[0], bandId: 'b5' })).status).toBe(200);
    expect(updates[0]).toEqual({ academy_intake: { medicalHistory: 'בריא', focus: COACHING_TYPES[0] }, academy_band_id: 'b5' });
  });
  it('rejects a coaching type the academy does not sell', async () => {
    caller.mockResolvedValue({ denied: null, caller: { athleteId: 'coach' } });
    expect((await put({ athleteId: 'yossi', coachingType: 'x' })).status).toBe(400);
  });
});
