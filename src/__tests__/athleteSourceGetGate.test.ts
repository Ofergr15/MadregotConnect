import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const from = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from }) }));
let gate: { denied: Response | null } = { denied: null };
vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaffCaller: vi.fn(async () => ({ ...gate, caller: {} })) }));

const rows = [{ id: 'a1', name: 'A', data_source: 'garmin', strava_auth: null, strava_enabled: false, garmin_auth: 'enc' }];
beforeEach(() => {
  from.mockReset();
  from.mockReturnValue({ select: () => ({ order: async () => ({ data: rows, error: null }) }) });
});

describe('GET /api/admin/athlete-source', () => {
  it('refuses a non-staff caller before reading the roster', async () => {
    gate = { denied: NextResponse.json({ error: 'Staff access required' }, { status: 403 }) };
    const { GET } = await import('@/app/api/admin/athlete-source/route');
    const res = await GET(new Request('http://x/api/admin/athlete-source'));
    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });
  it('refuses an anonymous caller', async () => {
    gate = { denied: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
    const { GET } = await import('@/app/api/admin/athlete-source/route');
    expect((await GET(new Request('http://x'))).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
  it('serves staff, booleans only — never the stored credential', async () => {
    gate = { denied: null };
    const { GET } = await import('@/app/api/admin/athlete-source/route');
    const res = await GET(new Request('http://x'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.athletes[0]).toEqual({ id: 'a1', name: 'A', dataSource: 'garmin', hasGarmin: true, hasStrava: false, stravaEnabled: false });
    expect(JSON.stringify(body)).not.toContain('enc');
  });
});
