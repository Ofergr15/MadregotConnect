import { describe, expect, it, vi, beforeEach } from 'vitest';
import { looksLikeAthleteId, viewAsApplies } from '@/lib/auth/view-as';

// "View as this person" (lib/auth/view-as.ts): the super user's token plus
// `x-view-as: <athleteId>` is answered as that athlete — on the academy's reads
// only, and never for anybody else's token.

const OFER = { id: '00000000-0000-4000-8000-000000000001', email: 'grosfeldofer@gmail.com', name: 'Ofer', role: 'admin', status: 'active', approved: true };
const DANA = { id: '00000000-0000-4000-8000-0000000000da', email: 'dana@x.com', name: 'Dana', role: 'academy_coach', status: 'active', approved: true, is_super_user: false };
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
          const all = [OFER, DANA, RUNNER];
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

  it('means nothing outside the academy: the super user stays themselves', async () => {
    for (const path of ['/api/feed', '/api/auth/me', '/api/athletes']) {
      const r = await requireSession(req(path, DANA.id));
      expect(r.ok && r.user.athleteId).toBe(OFER.id);
    }
  });

  it('means nothing from anybody but the super user', async () => {
    me = RUNNER;
    const r = await requireSession(req('/api/academy/members', DANA.id));
    expect(r.ok && r.user.athleteId).toBe(RUNNER.id);
  });

  it('refuses a malformed id and an unknown one', async () => {
    const bad = await requireSession(req('/api/academy/members', 'not-a-uuid'));
    expect(!bad.ok && bad.status).toBe(400);
    const gone = await requireSession(req('/api/academy/members', '00000000-0000-4000-8000-00000000ffff'));
    expect(!gone.ok && gone.status).toBe(404);
  });

  it('knows where it applies', () => {
    expect(viewAsApplies('/api/academy/members')).toBe(true);
    expect(viewAsApplies('/api/academyx')).toBe(false);
    expect(viewAsApplies('/api/auth/me')).toBe(false);
    expect(looksLikeAthleteId(DANA.id)).toBe(true);
    expect(looksLikeAthleteId("x' or 1=1")).toBe(false);
  });
});
