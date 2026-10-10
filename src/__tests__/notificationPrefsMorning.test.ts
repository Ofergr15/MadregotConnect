import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * PATCH /api/athletes/notification-prefs — the morning reminder's setting (screen 9).
 *
 * The time is validated onto the cron tick's 5-minute grid, anything else is a 400, the
 * gate is self-or-staff, and the merge keeps every other key of notification_prefs (the
 * categories, the language) exactly as it was. GET answers the effective setting.
 */

const ME = uid();
const OTHER = uid();

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r),
  mayActFor: (c: { athleteId: string }, id: string) => c.athleteId === id,
}));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { GET, PATCH } = await import('@/app/api/athletes/notification-prefs/route');
const patch = (body: unknown) => PATCH(new Request('http://x/api/athletes/notification-prefs', { method: 'PATCH', body: JSON.stringify(body) }));
const saved = () => db.tables.athletes.find(a => a.id === ME)!.notification_prefs;

beforeEach(() => {
  db = createMemoryDb({ schema: { athletes: ['id', 'role', 'notification_prefs'] } });
  db.tables.athletes.push({ id: ME, role: 'runner', notification_prefs: { teammates: false, language: 'en' } });
  db.tables.athletes.push({ id: OTHER, role: 'runner', notification_prefs: null });
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: ME } });
});

describe('the morning reminder setting', () => {
  it('GET: the effective setting — off until switched on while TRAINEE_V2_FOR_ALL is off', async () => {
    const res = await GET(new Request(`http://x/api/athletes/notification-prefs?athleteId=${ME}`));
    expect((await res.json()).morningReminder).toEqual({ enabled: false, time: '06:00' });
  });

  it('PATCH: switches it on and merges, keeping every other key', async () => {
    const res = await patch({ athleteId: ME, morningReminder: { enabled: true } });
    expect(res.status).toBe(200);
    expect((await res.json()).morningReminder).toEqual({ enabled: true, time: '06:00' });
    expect(saved()).toEqual({ teammates: false, language: 'en', morningReminder: { enabled: true, time: '06:00' } });

    // A time-only change keeps it on, snapped to the 5-minute grid.
    await patch({ athleteId: ME, morningReminder: { time: '05:43' } });
    expect(saved()).toEqual({ teammates: false, language: 'en', morningReminder: { enabled: true, time: '05:45' } });
  });

  it('PATCH: anything that is not a boolean or an HH:MM is a 400, and nothing is written', async () => {
    for (const morningReminder of [{ time: '5:45' }, { time: '25:00' }, { enabled: 'on' }, {}, null]) {
      expect((await patch({ athleteId: ME, morningReminder })).status).toBe(400);
    }
    expect((await patch({ morningReminder: { enabled: true } })).status).toBe(400);
    expect(saved()).toEqual({ teammates: false, language: 'en' });
  });

  it('PATCH: somebody else\'s setting is 403', async () => {
    const res = await patch({ athleteId: OTHER, morningReminder: { enabled: true } });
    expect(res.status).toBe(403);
    expect(db.tables.athletes.find(a => a.id === OTHER)!.notification_prefs).toBeNull();
  });
});
