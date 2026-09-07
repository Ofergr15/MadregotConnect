import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Approving somebody has to actually let them in.
 *
 * Two doors, and until now the approve button only opened one of them. The club
 * keeps a maintenance window open for days at a time (19 of 28 members are behind
 * one deliberately), so approving a new signup moved them from "not approved" to
 * "approved and still blocked" — the identical closed door on their phone, with no
 * hint to the admin that anything was left to do. Approval now releases in the
 * same request.
 *
 * The 403 case is the other half: this endpoint gated on canApprove(session email)
 * — an email LITERAL — and login is Strava-only, so the address is always the
 * synthetic `strava_<id>@…local`. It could never match, so approval was broken for
 * every approver in the club, the same way the maintenance toggle was.
 */

let settings: { mode: string; allow: string };
let athlete: Record<string, unknown> | null;
let updated: Record<string, unknown> | null;
let allowWritten: string | null;
let canApprove: boolean;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'app_settings') {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { key: 'maintenance_mode', value: settings.mode },
                { key: 'maintenance_allow', value: settings.allow },
              ],
              error: null,
            }),
          }),
          upsert: async (rows: Array<{ key: string; value: string }>) => {
            for (const row of rows) {
              if (row.key === 'maintenance_allow') {
                allowWritten = row.value;
                settings.allow = row.value;
              }
            }
            return { error: null };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: athlete, error: athlete ? null : { code: 'X' } }) }) }),
        update: (values: Record<string, unknown>) => ({
          eq: async () => {
            updated = values;
            return { error: null };
          },
        }),
      };
    },
  }),
}));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({
    ok: true,
    user: {
      email: 'strava_106828158@strava.madregot.local',
      athleteEmail: 'coach@madregot.club',
      athleteId: 'admin-1',
      role: 'coach',
      isStaff: true,
      isSuperUser: true,
      canApprove,
      isCoreRunner: false,
    },
  }),
  authError: () => new Response('unauthorized', { status: 401 }),
}));

// Email and push are the approval's side channels; neither is what this pins.
vi.mock('@/lib/email', () => ({
  notifyUserApproved: async () => {},
  notifyAdminUserApproved: async () => {},
  notifyAcademyApproved: async () => {},
}));
vi.mock('@/lib/push', () => ({ notifyAthlete: async () => {} }));

const { POST } = await import('@/app/api/admin/approve/route');

const approve = (athleteId: string) =>
  POST(new Request('https://madregot.app/api/admin/approve', {
    method: 'POST',
    body: JSON.stringify({ athleteId }),
  }) as never);

beforeEach(() => {
  settings = { mode: 'on', allow: 'admin-1,coach@madregot.club' };
  athlete = { id: 'dana-1', name: 'דנה', email: 'dana@example.com', approved: false };
  updated = null;
  allowWritten = null;
  canApprove = true;
});

describe('POST /api/admin/approve during a maintenance window', () => {
  it('approves the row AND takes them off the block', async () => {
    const res = await approve('dana-1');
    expect(res.status).toBe(200);
    expect(updated).toMatchObject({ approved: true, status: 'active' });
    expect(allowWritten!.split(',')).toContain('dana-1');
    expect(await res.json()).toMatchObject({ success: true, released: true });
  });

  it('keeps everybody already exempt on the list', async () => {
    // Union, never a replacement: a release must not be able to lock the admin out
    // of their own switch.
    await approve('dana-1');
    const allow = allowWritten!.split(',');
    expect(allow).toContain('admin-1');
    expect(allow).toContain('coach@madregot.club');
  });

  it('releases somebody who was already approved instead of doing nothing', async () => {
    // The path that used to answer "Already approved" and stop — leaving an
    // approved member staring at the maintenance screen.
    athlete = { id: 'yossi-1', email: 'yossi@example.com', approved: true };
    const res = await approve('yossi-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ released: true });
    expect(allowWritten!.split(',')).toContain('yossi-1');
    expect(updated).toBeNull();
  });

  it('writes the id, never the synthetic Strava address', async () => {
    athlete = { id: 'ron-1', email: 'strava_37085164@strava.madregot.local', approved: false };
    await approve('ron-1');
    const allow = allowWritten!.split(',');
    expect(allow).toContain('ron-1');
    expect(allow.some((h) => h.endsWith('.local'))).toBe(false);
  });

  it('touches no allowlist while the club is open', async () => {
    // Nobody to release, and pre-authorising people for the NEXT window would be a
    // surprise to whoever is curating that list.
    settings = { mode: 'off', allow: '' };
    const res = await approve('dana-1');
    expect(allowWritten).toBeNull();
    expect(await res.json()).toMatchObject({ released: false, maintenance: false });
    expect(updated).toMatchObject({ approved: true });
  });

  it('does not need a second tap: the release is idempotent', async () => {
    settings = { mode: 'on', allow: 'admin-1,dana-1,dana@example.com' };
    const res = await approve('dana-1');
    expect(allowWritten).toBeNull();
    expect(await res.json()).toMatchObject({ released: false, maintenance: true });
  });

  it('refuses a caller who is not an approver, and changes nothing', async () => {
    canApprove = false;
    const res = await approve('dana-1');
    expect(res.status).toBe(403);
    expect(updated).toBeNull();
    expect(allowWritten).toBeNull();
  });
});
