import { describe, expect, it, vi, beforeEach } from 'vitest';
import { looksLikeAthleteId, viewAsApplies, viewAsTag, VIEW_AS_DENY } from '@/lib/auth/view-as';

// Manager write routes under view-as, through the REAL requireSession (same harness as sessionViewAs.test.ts).
// "View as this person" (lib/auth/view-as.ts): an admin's token plus
// `x-view-as: <athleteId>` is answered as that athlete — on every /api/ read but
// the deny-list, and never for a non-admin's token.

const OFER = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test', name: 'Ofer', role: 'admin', status: 'active', approved: true };
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

describe('view-as is enforced server-side on the manager write routes', () => {
  const WRITES = ['/api/events', '/api/events/00000000-0000-4000-8000-0000000000e1', '/api/admin/approve',
    '/api/admin/registrations/approve', '/api/admin/publish/message', '/api/club-updates', '/api/club-updates/topics',
    '/api/admin/roles', '/api/admin/people/delete'];
  it('every manager write path refuses POST/PATCH/DELETE while viewing as a member', async () => {
    for (const path of WRITES) for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const r = await requireSession(req(path, RUNNER.id, method));
      expect(!r.ok && r.status, `${method} ${path}`).toBe(403);
      expect(!r.ok && r.error).toBe('view_as_read_only');
    }
  });
  it('the capabilities read answers as the viewed member, with no admin powers carried over', async () => {
    const r = await requireSession(req('/api/me/capabilities', ADMIN.id));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.athleteId).toBe(ADMIN.id);
      expect(r.user.isSuperUser).toBe(false);
      expect(r.user.canApprove).toBe(false);
      expect(r.user.viewingAsBy).toBe('owner@example.test');
    }
  });
  it('a non-admin cannot use the header to act as someone else: the write is theirs, not the viewed person\'s', async () => {
    me = DANA;
    const r = await requireSession(req('/api/events', RUNNER.id, 'POST'));
    expect(r.ok && r.user.athleteId).toBe(DANA.id);
  });
});
