import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * GET /api/admin/users — the roster the User Manager screen is built on.
 *
 * Two facts were missing from it, and both are why "I approved them and they
 * still can't get in" kept coming back:
 *
 *  1. **`blocked`** — the maintenance window is the SECOND door. A roster that
 *     reports only `approved` is a roster that lies while a window is open; 19 of
 *     28 members were approved and locked out at the same time and no screen said
 *     so. This is the same verdict resolveVerifiedCaller enforces, resolved
 *     server-side so the screen cannot disagree with the gate.
 *  2. **`hasWatch`** — from garmin_auth/strava_auth PRESENCE. The screen used to
 *     read `onboarding_status === 'garmin_authed'`, which stays set after a
 *     credential is cleared, so it showed a watch for people who had none.
 *
 * And one thing that must never appear: the credentials themselves. They are
 * OAuth tokens, encrypted at rest, and this response goes to a browser.
 */

let rows: Array<Record<string, unknown>>;
let maintenance: { on: boolean; allow: string[] };
let staff: boolean;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({ order: async () => ({ data: rows, error: null }) }),
    }),
  }),
}));

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => (staff
    ? { denied: null, caller: { email: 'coach@madregot.club', isStaff: true, isSuperUser: false } }
    : { denied: null, caller: { email: 'runner@x.com', isStaff: false, isSuperUser: false } }),
}));

vi.mock('@/lib/maintenance', () => ({
  readMaintenance: async () => maintenance,
}));

const { GET } = await import('@/app/api/admin/users/route');

const get = () => GET(new Request('https://madregot.app/api/admin/users') as never);

beforeEach(() => {
  staff = true;
  maintenance = { on: true, allow: ['coach@madregot.club', 'ron-1'] };
  rows = [
    // Approved, no exemption, no watch: the state that looks fine and isn't.
    { id: 'dana-1', email: 'dana@example.com', name: 'דנה', role: 'runner', approved: true, garmin_auth: null, strava_auth: null },
    // On the allowlist by id, and a Strava credential on file.
    { id: 'ron-1', email: 'strava_37085164@strava.madregot.local', name: 'רון', role: 'runner', approved: true, garmin_auth: null, strava_auth: '<encrypted>' },
  ];
});

describe('GET /api/admin/users — the second door', () => {
  it('marks an approved member the window is keeping out', async () => {
    const { users, maintenance: on } = await (await get()).json();
    expect(on).toBe(true);
    expect(users.find((u: any) => u.id === 'dana-1')).toMatchObject({ approved: true, blocked: true });
  });

  it('does not mark somebody the allowlist exempts', async () => {
    const { users } = await (await get()).json();
    expect(users.find((u: any) => u.id === 'ron-1').blocked).toBe(false);
  });

  it('blocks nobody while the club is open', async () => {
    maintenance = { on: false, allow: [] };
    const { users, maintenance: on } = await (await get()).json();
    expect(on).toBe(false);
    expect(users.every((u: any) => u.blocked === false)).toBe(true);
  });

  it('reads a watch from the credential, not from onboarding_status', async () => {
    // The row that fooled the old screen: the status column still says authed,
    // the credential is gone.
    rows = [{ id: 'x', email: 'x@y.com', name: 'X', role: 'runner', approved: true, onboarding_status: 'garmin_authed', garmin_auth: null, strava_auth: null }];
    const { users } = await (await get()).json();
    expect(users[0].hasWatch).toBe(false);
  });

  it('never serialises the credentials themselves', async () => {
    // OAuth tokens, encrypted at rest. Presence is the only thing that may leave.
    const body = await (await get()).text();
    expect(body).not.toMatch(/garmin_auth|strava_auth|<encrypted>/);
  });

  it('refuses a caller who is not staff', async () => {
    staff = false;
    expect((await get()).status).toBe(403);
  });
});
