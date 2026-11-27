import { describe, expect, it, vi } from 'vitest';
import { FEATURES, FEATURE_KEYS } from '@/lib/features/flags';
import { buildCatalog } from '@/lib/features/catalog';

describe('FEATURES is the single source for the catalogue', () => {
  it('every flag has a Hebrew label and a one-line Hebrew description', () => {
    for (const k of FEATURE_KEYS) {
      const f = FEATURES[k];
      expect(f.label.trim(), k).not.toBe('');
      expect(f.description.trim(), k).not.toBe('');
      expect(f.description, k).toMatch(/[֐-׿]/);
      expect(f.description, k).not.toMatch(/\n/);
      expect(f.description.length, k).toBeLessThanOrEqual(120);
    }
  });
  it('lists every key exactly once, in FEATURES order', () => {
    expect(buildCatalog(null).map((e) => e.key)).toEqual(FEATURE_KEYS);
  });
});

describe('buildCatalog scopes', () => {
  const rows = [
    { feature: 'history', scope_type: 'club' as const, scope_id: '*', enabled: true },
    { feature: 'history', scope_type: 'role' as const, scope_id: 'coach', enabled: false },
    { feature: 'history', scope_type: 'squad' as const, scope_id: 'g2', enabled: true },
    { feature: 'history', scope_type: 'athlete' as const, scope_id: 'a1', enabled: true },
    { feature: 'history', scope_type: 'athlete' as const, scope_id: 'a2', enabled: false },
    { feature: 'native_mgmt_users', scope_type: 'academy' as const, scope_id: 'academy', enabled: false },
    { feature: 'history', scope_type: 'bogus' as never, scope_id: 'x', enabled: true },
  ];
  const cat = buildCatalog(rows);
  const history = cat.find((e) => e.key === 'history')!;
  it('reports club / role / squad rows and athlete counts, never athlete ids', () => {
    expect(history.scopes).toEqual({
      club: true, academy: null,
      roles: [{ id: 'coach', enabled: false }], squads: [{ id: 'g2', enabled: true }],
      athletes: { on: 1, off: 1 },
    });
    expect(JSON.stringify(history)).not.toContain('a1');
    expect(history.anyEnabled).toBe(true);
  });
  it('an explicit off is not "enabled anywhere"; flags admin-only and public keys', () => {
    const users = cat.find((e) => e.key === 'native_mgmt_users')!;
    expect(users.scopes.academy).toBe(false);
    expect(users.anyEnabled).toBe(false);
    expect(users.adminOnly).toBe(true);
    expect(cat.find((e) => e.key === 'gateway_v4')!.public).toBe(true);
  });
});

let denied: Response | null = null;
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireStaffCaller: async () => ({ denied, caller: { athleteId: 's1' } }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/features/server', () => ({
  readEnablementRows: async () => ({ rows: null, failed: false }),
}));

describe('GET /api/features/catalog', () => {
  it('refuses a non-staff caller', async () => {
    denied = new Response('{}', { status: 403 });
    const { GET } = await import('@/app/api/features/catalog/route');
    expect((await GET(new Request('http://x/api/features/catalog'))).status).toBe(403);
  });
  it('answers every flag, flagging an unapplied migration', async () => {
    denied = null;
    const { GET } = await import('@/app/api/features/catalog/route');
    const json = await (await GET(new Request('http://x/api/features/catalog'))).json();
    expect(json.features).toHaveLength(FEATURE_KEYS.length);
    expect(json.migrationPending).toBe(true);
  });
});
