import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addedTabs, newlyGranted, pendingWelcome, viewForRole, welcomeRoleOf } from '@/lib/role-views';
import { roleGrantedCopy } from '@/lib/notifications/copy';

/**
 * "קיבלת תפקיד חדש" — the push the roles screen sends when a role is switched on,
 * and the welcome it opens. The route half is about what only the route can get
 * wrong: a push for a role switched ON and never for one switched off, and the
 * resend refusing somebody who holds no role at all.
 */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
}));

const notifyAthlete = vi.fn(async (_opts: unknown) => {});
vi.mock('@/lib/push', () => ({ notifyAthlete: (opts: unknown) => notifyAthlete(opts) }));

type Row = Record<string, unknown>;
const db: { athletes: Row[]; scheduled_notifications: Row[] } = { athletes: [], scheduled_notifications: [] };

class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private single = false;
  private patch: Row | null = null;
  constructor(private table: keyof typeof db) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.single = true; return this; }
  update(p: Row) { this.patch = p; return this; }
  then<A, B>(ok?: ((v: { data: unknown; error: unknown }) => A) | null, bad?: ((e: unknown) => B) | null) {
    const rows = db[this.table].filter(r => this.filters.every(f => f(r)));
    if (this.patch) for (const r of rows) Object.assign(r, this.patch);
    const data = this.single ? rows[0] ?? null : rows;
    return Promise.resolve({ data, error: null }).then(ok, bad);
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (t: keyof typeof db) => new Query(t) }),
}));

const ADMIN = { email: 'boss@x', isSuperUser: true, canApprove: true, isStaff: true, athleteId: 'boss', role: 'admin', roles: ['admin'] };

function req(method: string, body: unknown) {
  return new Request('http://x/api/admin/roles', { method, body: JSON.stringify(body) });
}

beforeEach(() => {
  db.athletes = [
    { id: 'boss', name: 'Ofer Gros', role: 'admin', extra_roles: [], status: 'active' },
    { id: 'shahar', name: 'Shahar Levi', role: 'runner', extra_roles: [], status: 'active' },
    { id: 'dan', name: 'Dan Ron', role: 'coach', extra_roles: ['academy_coach'], status: 'active' },
  ];
  db.scheduled_notifications = [];
  notifyAthlete.mockClear();
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: ADMIN });
});

describe('the pure half', () => {
  it('maps each role to the view it opens', () => {
    expect(viewForRole('academy_coach')).toBe('coach');
    expect(viewForRole('coach')).toBe('coach');
    expect(viewForRole('academy_manager')).toBe('manager');
    expect(viewForRole('admin')).toBe('admin');
    expect(viewForRole('runner')).toBeNull();
  });

  it('lists only roles switched on, highest first', () => {
    expect(newlyGranted(['coach'], ['coach', 'academy_coach', 'academy_manager'])).toEqual(['academy_manager', 'academy_coach']);
    expect(newlyGranted(['coach', 'admin'], ['coach'])).toEqual([]);
  });

  it('welcomes the highest role held', () => {
    expect(welcomeRoleOf(['academy_coach', 'coach'])).toBe('coach');
    expect(welcomeRoleOf([])).toBeNull();
  });

  it('welcomes from the link only for a role still held', () => {
    expect(pendingWelcome(['runner', 'academy_coach'], 'academy_coach', null)).toBe('academy_coach');
    expect(pendingWelcome(['runner'], 'academy_coach', null)).toBeNull();
  });

  it('catches a missed push on the next open, but never on the first look', () => {
    expect(pendingWelcome(['runner', 'coach'], null, ['runner'])).toBe('coach');
    expect(pendingWelcome(['runner', 'coach'], null, null)).toBeNull();
    expect(pendingWelcome(['runner', 'coach'], null, ['runner', 'coach'])).toBeNull();
  });

  it('lists the tabs a view adds, never the profile', () => {
    const runner = [{ tab: 'feed' }, { tab: 'profile' }];
    const coach = [{ tab: 'feed' }, { tab: 'athletes' }, { tab: 'profile' }, { tab: 'coach-tools' }];
    expect(addedTabs(coach, runner).map(i => i.tab)).toEqual(['athletes', 'coach-tools']);
  });

  it('names the role, the person who added them, and where the tap goes', () => {
    const he = roleGrantedCopy('he', { role: 'academy_coach', by: 'Ofer Gros' });
    expect(he.title).toBe('🎓 קיבלת תפקיד חדש: מאמן אקדמיה');
    expect(he.body).toContain('Ofer הוסיף אותך');
    expect(he.body).toContain('תצוגת המאמן');
    expect(roleGrantedCopy('en', { role: 'admin' }).body).not.toContain('undefined');
  });
});

describe('PUT /api/admin/roles', () => {
  it('pushes the new role, opening its view', async () => {
    const { PUT } = await import('@/app/api/admin/roles/route');
    const res = await PUT(req('PUT', { athleteId: 'shahar', roles: ['academy_coach'] }));
    const body = await res.json();
    expect(body.notified).toBe('academy_coach');
    expect(notifyAthlete).toHaveBeenCalledTimes(1);
    const opts = notifyAthlete.mock.calls[0][0] as { athleteId: string; url: string; kind: string };
    expect(opts).toMatchObject({ athleteId: 'shahar', url: '/dashboard?welcome=academy_coach', kind: 'role_granted' });
  });

  it('sends nothing when a role is only taken away', async () => {
    const { PUT } = await import('@/app/api/admin/roles/route');
    const res = await PUT(req('PUT', { athleteId: 'dan', roles: ['coach'] }));
    expect((await res.json()).notified).toBeNull();
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/roles (send again)', () => {
  it('sends the highest role held', async () => {
    const { POST } = await import('@/app/api/admin/roles/route');
    const res = await POST(req('POST', { athleteId: 'dan', action: 'notify' }));
    expect(res.status).toBe(200);
    expect((notifyAthlete.mock.calls[0][0] as { url: string }).url).toBe('/dashboard?welcome=coach');
  });

  it('refuses somebody with no role', async () => {
    const { POST } = await import('@/app/api/admin/roles/route');
    const res = await POST(req('POST', { athleteId: 'shahar', action: 'notify' }));
    expect(res.status).toBe(400);
    expect(notifyAthlete).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { ...ADMIN, isSuperUser: false, role: 'coach', roles: ['coach'] } });
    const { POST } = await import('@/app/api/admin/roles/route');
    const res = await POST(req('POST', { athleteId: 'dan', action: 'notify' }));
    expect(res.status).toBe(403);
  });
});
