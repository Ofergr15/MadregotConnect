import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Letting one member back in during a maintenance window — from the roster.
 *
 * The window used to be invisible on the screen that lists the club: the switch
 * was in Settings and the allowlist was a comma-separated text field, so "why
 * can't Dana get in" had no answer next to Dana's name. The roster now shows who
 * is shut out and releases them with a tap, which writes the allowlist.
 *
 * That new write is why the lock-yourself-out safeguard had to move. It used to
 * run only when the request said `on: true`, leaving the other way in wide open:
 * edit the allowlist during a window and you can remove yourself. The admin is a
 * member of their own roster, so one tap on their own row would have produced a
 * window nobody can end from inside the app — the exact production incident of
 * 2026-09-07, reached by a different door.
 */

let settings: { mode: string; allow: string };
let upserted: Array<{ key: string; value: string }>;
let canApprove: boolean;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
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
        upserted.push(...rows);
        // The route re-reads to answer, so the write has to be visible.
        for (const row of rows) {
          if (row.key === 'maintenance_mode') settings.mode = row.value;
          if (row.key === 'maintenance_allow') settings.allow = row.value;
        }
        return { error: null };
      },
    }),
  }),
}));

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const MEMBER_ID = '22222222-2222-2222-2222-222222222222';

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({
    ok: true,
    user: {
      // Synthetic, like every login in this app: Strava is the only way in.
      email: 'strava_106828158@strava.madregot.local',
      athleteEmail: 'coach@madregot.club',
      athleteId: ADMIN_ID,
      role: 'coach',
      isStaff: true,
      isSuperUser: true,
      canApprove,
      isCoreRunner: false,
    },
  }),
  authError: () => new Response('unauthorized', { status: 401 }),
}));

const { PUT } = await import('@/app/api/maintenance/route');

const put = (body: unknown) =>
  PUT(new Request('https://madregot.app/api/maintenance', { method: 'PUT', body: JSON.stringify(body) }));

const allowWritten = () => upserted.filter((r) => r.key === 'maintenance_allow').at(-1)?.value.split(',') ?? null;

beforeEach(() => {
  settings = { mode: 'on', allow: `${ADMIN_ID},coach@madregot.club` };
  upserted = [];
  canApprove = true;
});

describe('PUT /api/maintenance — releasing a member from the roster', () => {
  it('writes the member onto the allowlist', async () => {
    const res = await put({ allowlist: [ADMIN_ID, 'coach@madregot.club', MEMBER_ID] });
    expect(res.status).toBe(200);
    expect(allowWritten()).toContain(MEMBER_ID);
    // An id, not an address: a Strava signup never provides one, so plenty of rows
    // have no address to match and the id is the only handle everybody has.
    expect(await res.json()).toMatchObject({ maintenance: true });
  });

  it('keeps the actor on the list even when the edit drops them', async () => {
    // The whole point. The roster can shut one member out with a tap and the admin
    // is on their own roster.
    const res = await put({ allowlist: [MEMBER_ID] });
    expect(res.status).toBe(200);
    const allow = allowWritten();
    expect(allow).toContain(MEMBER_ID);
    expect(allow).toContain(ADMIN_ID);
    expect(allow).toContain('coach@madregot.club');
  });

  it('never writes the synthetic JWT address, which can match nobody', async () => {
    await put({ allowlist: [MEMBER_ID] });
    expect(allowWritten()!.some((h) => h.endsWith('.local'))).toBe(false);
  });

  it('leaves the list exactly as sent while maintenance is off', async () => {
    // No window, nobody to lock out: the safeguard must not quietly add the admin
    // to a list they are curating for later.
    settings = { mode: 'off', allow: '' };
    await put({ allowlist: [MEMBER_ID] });
    expect(allowWritten()).toEqual([MEMBER_ID]);
  });

  it('still auto-adds the actor when the window is opened', async () => {
    settings = { mode: 'off', allow: '' };
    await put({ on: true });
    expect(allowWritten()).toContain(ADMIN_ID);
  });

  it('turns the window off without touching the allowlist', async () => {
    const res = await put({ on: false });
    expect(await res.json()).toMatchObject({ maintenance: false });
    expect(allowWritten()).toBeNull();
  });

  it('refuses a caller who is not an approver', async () => {
    canApprove = false;
    const res = await put({ allowlist: [MEMBER_ID] });
    expect(res.status).toBe(403);
    expect(upserted).toEqual([]);
  });
});
