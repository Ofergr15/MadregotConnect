// B11: role-mutation authorization matrix for PUT /api/admin/users (Settings → Users).
// FIXTURE only. canGrantAdmin is stubbed to one fixture address; no real account.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createMemoryDb } from './helpers/memory-db';

const db = createMemoryDb({ schema: { athletes: ['id', 'email', 'role'] } });
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<typeof import('@/lib/constants')>()), canGrantAdmin: (e?: string | null) => e === 'granter@example.test' }));
let caller: any = null;
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/self-or-staff')>()), resolveVerifiedCaller: async () => caller }));

const who = (role: string, isStaff: boolean, email = `${role}@example.test`, isSuperUser = false) =>
  ({ denied: null, caller: { athleteId: role, role, isStaff, isSuperUser, email } });
const put = async (email: string, role: string) => {
  const { PUT } = await import('@/app/api/admin/users/route');
  const res = await PUT(new Request('http://x/api/admin/users', { method: 'PUT', body: JSON.stringify({ email, role }) }));
  return res.status;
};
const roleOf = (e: string) => db.tables.athletes.find((r) => r.email === e)!.role;

beforeEach(() => {
  db.tables.athletes.length = 0;
  db.tables.athletes.push(
    { id: '1', email: 'runner@example.test', role: 'runner' },
    { id: '2', email: 'coach2@example.test', role: 'coach' },
    { id: '3', email: 'admin2@example.test', role: 'admin' },
  );
});

describe('PUT /api/admin/users role matrix', () => {
  it('anonymous (denied by the verifier) -> its status; nothing changes', async () => {
    caller = { denied: NextResponse.json({ error: 'x' }, { status: 401 }), caller: {} };
    expect(await put('runner@example.test', 'coach')).toBe(401);
    expect(roleOf('runner@example.test')).toBe('runner');
  });
  it('a runner -> 403', async () => {
    caller = who('runner', false);
    expect(await put('runner@example.test', 'coach')).toBe(403);
  });
  it('400 for an unknown role, including academy_coach (not grantable here)', async () => {
    caller = who('coach', true);
    expect(await put('runner@example.test', 'superadmin')).toBe(400);
    expect(await put('runner@example.test', 'academy_coach')).toBe(400);
  });
  it('404 for an unknown email; FINDING: the lookup is case-sensitive', async () => {
    caller = who('coach', true);
    expect(await put('nobody@example.test', 'coach')).toBe(404);
    expect(await put('RUNNER@example.test', 'coach')).toBe(404);
  });
  it.each(['coach', 'academy_coach', 'admin'])('FINDING: any staff role (%s) can promote a runner to coach', async (r) => {
    caller = who(r, true);
    expect(await put('runner@example.test', 'coach')).toBe(200);
    expect(roleOf('runner@example.test')).toBe('coach');
  });
  it('FINDING: any staff can demote another coach to runner', async () => {
    caller = who('academy_coach', true);
    expect(await put('coach2@example.test', 'runner')).toBe(200);
  });
  it('non-granter staff cannot grant OR remove admin', async () => {
    caller = who('coach', true);
    expect(await put('runner@example.test', 'admin')).toBe(403);
    expect(await put('admin2@example.test', 'runner')).toBe(403);
    expect(roleOf('admin2@example.test')).toBe('admin');
  });
  it('FINDING: a super-user whose address is not the granter is still refused admin (email check, not isSuperUser)', async () => {
    caller = who('runner', true, 'owner-via-strava@example.test', true);
    expect(await put('runner@example.test', 'admin')).toBe(403);
  });
  it('the granter address can grant and remove admin', async () => {
    caller = who('admin', true, 'granter@example.test');
    expect(await put('runner@example.test', 'admin')).toBe(200);
    expect(await put('admin2@example.test', 'coach')).toBe(200);
  });
});
