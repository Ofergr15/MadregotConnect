import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Maintenance mode as an actual block rather than a picture of one.
 *
 * It used to be an overlay and nothing else. Every way around the overlay was a
 * one-liner in the console — the screen asked `/api/maintenance?email=…` for an
 * address the CALLER chose, and read `coach_email` out of localStorage to decide
 * super-user — and behind it every API kept serving, so getting past the picture
 * handed you a fully working app.
 *
 * Two things are pinned here: the rule itself (pure, so it is readable without a
 * database), and the 503 out of resolveVerifiedCaller — the funnel every member,
 * staff and self-or-staff route uses, which is what makes the window real.
 */

const ON = { on: true, allow: ['coach@madregot.club'] };

// ── the rule ───────────────────────────────────────────────────────────────────
const { maintenanceBlocks } = await import('@/lib/maintenance');

describe('maintenanceBlocks', () => {
  it('blocks nobody while maintenance is off', () => {
    expect(maintenanceBlocks('runner@example.com', { on: false, allow: [] })).toBe(false);
    // Off means off even for somebody who happens to be listed.
    expect(maintenanceBlocks('coach@madregot.club', { on: false, allow: ['coach@madregot.club'] })).toBe(false);
  });

  it('lets an allowlisted address through, case and whitespace aside', () => {
    expect(maintenanceBlocks('coach@madregot.club', ON)).toBe(false);
    expect(maintenanceBlocks('  Coach@Madregot.Club ', ON)).toBe(false);
  });

  it('blocks everyone else, approved and staff included', () => {
    // This is the point of the change: being an approved, fully active member is
    // not an exemption. The allowlist is the only exemption there is, and the
    // person who turns the window on is auto-added to it (PUT /api/maintenance).
    expect(maintenanceBlocks('runner@example.com', ON)).toBe(true);
  });

  it('blocks a viewer with no resolvable identity', () => {
    // The allowlist cannot recognise somebody it knows nothing about, and "we
    // could not tell who you are" must not be the way in.
    expect(maintenanceBlocks('', ON)).toBe(true);
    expect(maintenanceBlocks(null, ON)).toBe(true);
    expect(maintenanceBlocks(undefined, ON)).toBe(true);
  });
});

// ── the gate ───────────────────────────────────────────────────────────────────
let maintenance: { on: boolean; allow: string[] };
let sessionEmail: string;

vi.mock('@/lib/maintenance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/maintenance')>();
  return { ...actual, readMaintenance: async () => maintenance };
});

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({
    ok: true,
    user: {
      email: sessionEmail,
      athleteId: 'a1',
      role: 'runner',
      isStaff: false,
      isSuperUser: false,
      canApprove: false,
      isCoreRunner: false,
    },
  }),
  authError: () => new Response('unauthorized', { status: 401 }),
}));

const { resolveVerifiedCaller } = await import('@/lib/auth/self-or-staff');

beforeEach(() => {
  maintenance = { on: false, allow: [] };
  sessionEmail = 'runner@example.com';
});

describe('resolveVerifiedCaller during maintenance', () => {
  it('serves a verified member normally when maintenance is off', async () => {
    const { denied, caller } = await resolveVerifiedCaller(new Request('https://madregot.app/api/feed'));
    expect(denied).toBeNull();
    expect(caller.athleteId).toBe('a1');
  });

  it('answers 503 to a member who is not on the allowlist', async () => {
    maintenance = ON;
    const { denied } = await resolveVerifiedCaller(new Request('https://madregot.app/api/feed'));
    expect(denied?.status).toBe(503);
    // 503, not 403: the club is closed for an hour, not to this person.
    expect(await denied!.json()).toMatchObject({ error: 'maintenance' });
  });

  it('hands back no identity with the refusal', async () => {
    // A route that ignores `denied` and reads `caller` anyway must not get a
    // usable caller out of a blocked request.
    maintenance = ON;
    const { caller } = await resolveVerifiedCaller(new Request('https://madregot.app/api/feed'));
    expect(caller.athleteId).toBeNull();
    expect(caller.email).toBe('');
    expect(caller.isStaff).toBe(false);
    expect(caller.isSuperUser).toBe(false);
  });

  it('still serves an allowlisted caller', async () => {
    maintenance = ON;
    sessionEmail = 'coach@madregot.club';
    const { denied, caller } = await resolveVerifiedCaller(new Request('https://madregot.app/api/feed'));
    expect(denied).toBeNull();
    expect(caller.email).toBe('coach@madregot.club');
  });
});
