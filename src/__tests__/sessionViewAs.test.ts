import { describe, expect, it, vi, beforeEach } from 'vitest';
import { looksLikeAthleteId, viewAsApplies, viewAsTag, VIEW_AS_DENY } from '@/lib/auth/view-as';

// "View as this person" (lib/auth/view-as.ts): an admin's token plus
// `x-view-as: <athleteId>` is answered as that athlete — on every /api/ read but
// the deny-list, and never for a non-admin's token.

const OFER = { id: '00000000-0000-4000-8000-000000000001', email: 'grosfeldofer@gmail.com', name: 'Ofer', role: 'admin', status: 'active', approved: true };
const DANA = { id: '00000000-0000-4000-8000-0000000000da', email: 'dana@x.com', name: 'Dana', role: 'academy_coach', status: 'active', approved: true, is_super_user: false };
const ADMIN = { id: '00000000-0000-4000-8000-0000000000ad', email: 'admin2@x.com', name: 'Second Admin', role: 'runner', extra_roles: ['admin'], status: 'active', approved: true, is_super_user: false };
const RUNNER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'runner@x.com', name: 'Runner', role: 'runner', status: 'active', approved: true };
let me: Record<string, unknown>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { email: me.email } }, error: null }) } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from() {
      const filters: Array<[string, unknown]> = [];
      const chain: Record<string, unknown> = {
        select: () => chain, order: () => chain, limit: () => chain, or: () => chain,
        eq: (col: string, v: unknown) => { filters.push([col, v]); return chain; },
        then: (resolve: (v: unknown) => unknown) => {
          const all = [OFER, DANA, RUNNER, ADMIN];
          const byId = filters.find(([c]) => c === 'id');
          const byEmail = filters.find(([c]) => c === 'email');
          const rows = byId ? all.filter((r) => r.id === byId[1]) : byEmail ? all.filter((r) => r.email === byEmail[1]) : [];
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return chain;
    },
  }),
}));

const { requireSession, clearSessionCache } = await import('@/lib/auth-session');

const tok = (seed: string) => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s-${seed}`;
const req = (path: string, viewAs?: string, method = 'GET') =>
  new Request(`https://madregot.app${path}`, {
    method,
    headers: { authorization: `Bearer ${tok(String(me.email))}`, ...(viewAs ? { 'x-view-as': viewAs } : {}) },
  });

beforeEach(() => {
  clearSessionCache();
  me = OFER;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

describe('view as this person', () => {
  it('answers an academy read as the athlete picked, without the super user\'s powers', async () => {
    const r = await requireSession(req('/api/academy/members', DANA.id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user.athleteId).toBe(DANA.id);
    expect(r.user.role).toBe('academy_coach');
    expect(r.user.isSuperUser).toBe(false);
    expect(r.user.canApprove).toBe(false);
    expect(r.user.viewingAsBy).toBe(OFER.email);
  });

  it('refuses every write while viewing', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await requireSession(req('/api/academy/coach', DANA.id, method));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
  });

  it('applies to the whole app, /api/auth/me included', async () => {
    for (const path of ['/api/feed', '/api/auth/me', '/api/athletes', '/api/notifications/unread', '/api/academy/members']) {
      const r = await requireSession(req(path, DANA.id));
      expect(r.ok && r.user.athleteId).toBe(DANA.id);
      expect(r.ok && r.user.viewingAsBy).toBe(OFER.email);
    }
  });

  it('is honoured for an admin who is not the super user (role held as an extra)', async () => {
    me = ADMIN;
    const r = await requireSession(req('/api/feed', RUNNER.id));
    expect(r.ok && r.user.athleteId).toBe(RUNNER.id);
    expect(r.ok && r.user.viewingAsBy).toBe(ADMIN.email);
  });

  it('refuses every write anywhere in the app while viewing', async () => {
    for (const path of ['/api/feed/like', '/api/workout-feedback/x/messages', '/api/academy/threads/messages', '/api/push/subscribe']) {
      const r = await requireSession(req(path, DANA.id, 'POST'));
      expect(!r.ok && r.status).toBe(403);
      expect(!r.ok && r.error).toBe('view_as_read_only');
    }
  });

  it('means nothing on the deny-listed paths: the admin stays themselves', async () => {
    for (const path of ['/api/auth/silent-session', '/api/auth/device-token', '/api/auth/resolve-role', '/api/strava/callback',
      '/api/garmin/sso-callback', '/api/cron/tick', '/api/maintenance', '/api/admin/view-as', '/api/dev/test-signin']) {
      const r = await requireSession(req(path, DANA.id));
      expect(r.ok && r.user.athleteId).toBe(OFER.id);
      expect(r.ok && r.user.viewingAsBy).toBeUndefined();
    }
    // A write on a denied path is the admin's own (sign-out, silent re-auth).
    const out = await requireSession(req('/api/auth/sign-out', DANA.id, 'POST'));
    expect(out.ok && out.user.athleteId).toBe(OFER.id);
  });

  it('means nothing from anybody who is not an admin, an academy coach included', async () => {
    for (const who of [RUNNER, DANA]) {
      me = who;
      clearSessionCache();
      const target = who === RUNNER ? DANA.id : RUNNER.id;
      for (const path of ['/api/academy/members', '/api/feed', '/api/auth/me']) {
        const r = await requireSession(req(path, target));
        expect(r.ok && r.user.athleteId).toBe(who.id);
        expect(r.ok && r.user.viewingAsBy).toBeUndefined();
      }
      // Ignored, not refused: their own write still goes through as themselves.
      const w = await requireSession(req('/api/feed/like', target, 'POST'));
      expect(w.ok && w.user.athleteId).toBe(who.id);
    }
  });

  it('refuses a malformed id and an unknown one', async () => {
    const bad = await requireSession(req('/api/academy/members', 'not-a-uuid'));
    expect(!bad.ok && bad.status).toBe(400);
    const gone = await requireSession(req('/api/academy/members', '00000000-0000-4000-8000-00000000ffff'));
    expect(!gone.ok && gone.status).toBe(404);
  });

  it('knows where it applies', () => {
    expect(viewAsApplies('/api/academy/members')).toBe(true);
    expect(viewAsApplies('/api/feed')).toBe(true);
    expect(viewAsApplies('/api/auth/me')).toBe(true);
    expect(viewAsApplies('/api/auth/silent-session')).toBe(false);
    expect(viewAsApplies('/api/maintenance')).toBe(false);
    // Whole segments, not string prefixes.
    expect(viewAsApplies('/api/maintenancex')).toBe(true);
    expect(viewAsApplies('/api/admin/view-as-other')).toBe(true);
    expect(viewAsApplies('/feed')).toBe(false);
    for (const p of VIEW_AS_DENY) expect(viewAsApplies(p.endsWith('/') ? `${p}x` : p)).toBe(false);
    expect(looksLikeAthleteId(DANA.id)).toBe(true);
    expect(looksLikeAthleteId("x' or 1=1")).toBe(false);
  });

  it('tags each person by the most specific role they hold', () => {
    expect(viewAsTag(['runner', 'admin'], false)).toBe('admin');
    expect(viewAsTag(['runner', 'academy_manager'], false)).toBe('academy_manager');
    expect(viewAsTag(['academy_coach'], false)).toBe('academy_coach');
    expect(viewAsTag(['coach'], true)).toBe('coach');
    expect(viewAsTag(['runner'], true)).toBe('trainee');
    expect(viewAsTag(['runner'], false)).toBe('runner');
  });
});
