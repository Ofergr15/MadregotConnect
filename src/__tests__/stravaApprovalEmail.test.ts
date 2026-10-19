import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Strava sign-in must leave an email before the approvers hear about it
 * (2026-10-19): Strava gives none, so without one approving them reaches nobody.
 * POST /api/onboarding/notify-email is where that address lands, and the first
 * one is what rings the approvers.
 */
const SYNTHETIC = 'strava_1@strava.madregot.local';
let athlete: { email: string; name: string; group_id: string | null; approved: boolean };
let request: { id: string; email: string; notify_email: string | null } | null;
const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
const inserts: Array<Record<string, unknown>> = [];

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { athleteId: 'a1' } }),
  authError: () => new Response('no', { status: 401 }),
}));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: vi.fn(async () => undefined), deviceFromUa: () => 'phone' }));
const announce = vi.fn(async () => undefined);
vi.mock('@/lib/signup-queue', () => ({ announceSignupRequest: (...a: unknown[]) => announce(...(a as [])) }));
const received = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/email', () => ({ notifyRegistrationReceived: (...a: unknown[]) => received(...(a as [])) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, eq: self, order: self, limit: self, not: self,
        maybeSingle: async () => ({
          data: table === 'athletes' ? athlete : table === 'signup_requests' ? request : { id: 'g3', name: 'Group 3' },
          error: null,
        }),
        update: (values: Record<string, unknown>) => {
          updates.push({ table, values });
          if (table === 'signup_requests' && request) request = { ...request, ...values } as typeof request;
          return { eq: async () => ({ error: null }) };
        },
        insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null }; },
      });
      return chain;
    },
  }),
}));

const { GET, POST } = await import('@/app/api/onboarding/notify-email/route');
const post = (body: unknown) => POST(new Request('http://x/api/onboarding/notify-email', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  athlete = { email: SYNTHETIC, name: 'Omer Weisman', group_id: null, approved: false };
  request = { id: 'r1', email: SYNTHETIC, notify_email: null };
  updates.length = 0; inserts.length = 0; announce.mockClear(); received.mockClear();
});

describe('the email a Strava sign-in leaves', () => {
  it('is asked for while missing', async () => {
    const d = await (await GET(new Request('http://x'))).json();
    expect(d).toMatchObject({ needed: true, email: null });
  });

  it('is not asked for when the row already has a real address', async () => {
    athlete.email = 'omer@gmail.com';
    expect(await (await GET(new Request('http://x'))).json()).toMatchObject({ needed: false });
  });

  it('first save: stored on the request, "we got it" sent to it, approvers told once', async () => {
    const res = await post({ email: ' Omer.W@Gmail.com ', groupId: 'g3' });
    expect(res.status).toBe(200);
    expect(updates).toContainEqual({ table: 'signup_requests', values: { notify_email: 'omer.w@gmail.com' } });
    // The group they picked, on their own unplaced row; never the address.
    expect(updates).toContainEqual({ table: 'athletes', values: { group_id: 'g3' } });
    expect(updates.some((u) => u.table === 'athletes' && 'email' in u.values)).toBe(false);
    expect(received).toHaveBeenCalledWith({ email: 'omer.w@gmail.com', name: 'Omer Weisman' });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0]).toEqual([expect.objectContaining({ contactEmail: 'omer.w@gmail.com', groupName: 'Group 3' })]);
  });

  it('fixing the address re-sends "we got it" but does not ring the approvers again', async () => {
    request!.notify_email = 'omer.w@gmial.com';
    await post({ email: 'omer.w@gmail.com' });
    expect(received).toHaveBeenCalledTimes(1);
    expect(announce).not.toHaveBeenCalled();
  });

  it('refuses something that is not an address, and the synthetic kind', async () => {
    expect((await post({ email: 'nope' })).status).toBe(400);
    expect((await post({ email: SYNTHETIC })).status).toBe(400);
    expect(announce).not.toHaveBeenCalled();
  });

  it('opens a request when there is none, so they are not invisible', async () => {
    request = null;
    await post({ email: 'omer.w@gmail.com' });
    expect(inserts[0]).toMatchObject({ athlete_id: 'a1', status: 'pending', source: 'strava-login', notify_email: 'omer.w@gmail.com' });
    expect(announce).toHaveBeenCalledTimes(1);
  });
});
